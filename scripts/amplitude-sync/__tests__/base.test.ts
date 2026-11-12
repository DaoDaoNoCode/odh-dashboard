// Name-stability check against a real temporary git repository.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeEntry } from './fixtures.ts';
import { checkAgainstBase, compareWithBase, loadEntriesAtCommit } from '../base.ts';
import { collectEntries, discoverCatalogFiles, loadCatalogModules } from '../catalog.ts';

const CATALOG = 'packages/demo/src/tracking/events.catalog.ts';

const catalogSource = (entries: string[]) =>
  [
    "import type { EventCatalog } from '@odh-dashboard/analytics/catalog';",
    '',
    'export const demoEvents = {',
    ...entries,
    '} as const satisfies EventCatalog;',
    '',
  ].join('\n');

const ACTIVE_A =
  "  A: { name: 'Demo A', description: 'Demo event A for the test.', category: 'Demo' },";
const DEPRECATED_B =
  "  B: { name: 'Demo B', description: 'Demo event B for the test.', category: 'Demo', " +
  "status: 'deprecated', deprecated: { since: '1.0', reason: 'Unused' } },";
const ACTIVE_C =
  "  C: { name: 'Demo C', description: 'Demo event C for the test.', category: 'Demo' },";

describe('compareWithBase', () => {
  it('fails for a dropped name, warns on reactivation and accepts tombstones', () => {
    const base = [
      makeEntry('Gone'),
      makeEntry('Back', { status: 'removed', removedIn: '1.0' }),
      makeEntry('Retired'),
      makeEntry('Kept'),
    ];
    const current = [
      makeEntry('Back'),
      makeEntry('Retired', { status: 'removed', removedIn: '2.0' }),
      makeEntry('Kept'),
      makeEntry('Brand New'),
    ];
    assert.deepEqual(compareWithBase(base, current, 'origin/main (abc)'), {
      errors: [
        'Event "Gone" was removed from the catalog (it was in packages/x/events.catalog.ts ' +
          "(xEvents.GONE) at origin/main (abc)). Keep it and set status: 'removed' (or " +
          "'deprecated' with replacedBy for a rename)",
      ],
      warnings: [
        'Event "Back" was \'removed\' at origin/main (abc) and is active again. Make sure the ' +
          'app sends it again.',
      ],
    });
  });
});

describe('checkAgainstBase (temporary git repo)', () => {
  let repo = '';
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
      ].concat(args),
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  const writeCatalog = (entries: string[]) => {
    const file = path.join(repo, CATALOG);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, catalogSource(entries));
  };
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  // The working-tree side is passed in as entries: re-importing an edited file in the same
  // process would hit Node's ESM cache. The CLI loads it once per process.
  const demo = (name: string, status = 'active') =>
    makeEntry(name, {
      file: CATALOG,
      ...(status === 'deprecated' && {
        status,
        deprecated: { since: '1.0', reason: 'Unused' },
      }),
    });

  let empty = '';
  let first = '';
  before(() => {
    // GIT_DIR & co. (set when running inside a git hook) would point git at the outer repo.
    for (const key of Object.keys(process.env).filter((k) => k.startsWith('GIT_'))) {
      delete process.env[key];
    }
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'amplitude-sync-repo-'));
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'README.md'), 'demo\n');
    empty = commit('no catalogs yet');
    writeCatalog([ACTIVE_A, DEPRECATED_B]);
    first = commit('add catalog');
  });
  after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('loads the catalogs as they are at a commit', async () => {
    const { files, entries, loadErrors } = await loadEntriesAtCommit(repo, first);
    assert.deepEqual(files, [CATALOG]);
    assert.deepEqual(loadErrors, []);
    assert.deepEqual(
      entries.map((e) => [e.name, e.status, e.file]),
      [
        ['Demo A', 'active', CATALOG],
        ['Demo B', 'deprecated', CATALOG],
      ],
    );
  });

  it('passes when nothing was dropped', async () => {
    const { modules } = await loadCatalogModules(repo, discoverCatalogFiles(repo));
    const result = await checkAgainstBase(repo, 'main', collectEntries(modules).entries);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.notes, [
      `Name-stability check against main (${first.slice(0, 12)}): 2 event(s) in 1 file(s).`,
    ]);
  });

  it('fails when a name is dropped and warns when a retired name is active again', async () => {
    const result = await checkAgainstBase(repo, 'main', [demo('Demo B')]);
    assert.equal(result.errors.length, 1);
    assert.match(
      result.errors[0],
      /^Event "Demo A" was removed from the catalog .*Keep it and set status: 'removed'/,
    );
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /^Event "Demo B" was 'deprecated' at main .* active again/);
  });

  it('compares a stale branch with its merge base, not the newer base tip', async () => {
    git('checkout', '-q', '-b', 'feature');
    git('checkout', '-q', 'main');
    writeCatalog([ACTIVE_A, DEPRECATED_B, ACTIVE_C]);
    const newer = commit('main adds Demo C');
    git('checkout', '-q', 'feature');
    const branchEntries = [demo('Demo A'), demo('Demo B', 'deprecated')];
    try {
      const result = await checkAgainstBase(repo, 'main', branchEntries);
      assert.deepEqual(result.errors, []);
      assert.match(result.notes[0], new RegExp(`against main \\(${first.slice(0, 12)}\\)`));

      // Comparing with the tip instead would wrongly blame the branch for Demo C.
      const atTip = await loadEntriesAtCommit(repo, newer);
      assert.match(
        compareWithBase(atTip.entries, branchEntries, 'tip').errors.join('\n'),
        /"Demo C" was removed/,
      );
    } finally {
      git('checkout', '-q', 'main');
    }
  });

  it('skips the check with a note when the ref does not exist', async () => {
    for (const ref of ['origin/does-not-exist', '--output=/tmp/x']) {
      // eslint-disable-next-line no-await-in-loop
      const result = await checkAgainstBase(repo, ref, []);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.notes, [
        `Base "${ref}" not found; skipped the name-stability check.`,
      ]);
    }
  });

  it('skips the check with a note when the base has no catalogs', async () => {
    const result = await checkAgainstBase(repo, empty, []);
    assert.deepEqual(result.errors, []);
    assert.match(result.notes.at(-1) ?? '', /^No catalogs at .*skipped the name-stability check/);
  });
});
