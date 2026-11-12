// End-to-end tests of sync.ts against a local fake Taxonomy API (no real network).
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const SYNC = path.resolve(import.meta.dirname, '..', 'sync.ts');

type Result = { code: number; stdout: string; stderr: string };

const run = (args: string[], env: Record<string, string | undefined> = {}): Promise<Result> =>
  new Promise((resolve) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      GITHUB_STEP_SUMMARY: '',
    };
    delete childEnv.AMPLITUDE_API_KEY;
    delete childEnv.AMPLITUDE_SECRET_KEY;
    Object.assign(childEnv, env);
    execFile(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', SYNC, ...args],
      { env: childEnv },
      (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
      },
    );
  });

type Request = { method: string; url: string; body: string; authorization?: string };

type FakeEvent = {
  // eslint-disable-next-line camelcase
  event_type: string;
  description: string | null;
  category: { name: string } | null;
  // eslint-disable-next-line camelcase
  display_name: string | null;
  tags: string[];
  deleted: boolean;
};

const fakeEvent = (name: string, fields: Partial<FakeEvent> = {}): FakeEvent => ({
  // eslint-disable-next-line camelcase
  event_type: name,
  description: '',
  category: null,
  // eslint-disable-next-line camelcase
  display_name: null,
  tags: [],
  deleted: false,
  ...fields,
});

/**
 * Stateful fake that mimics the Taxonomy API behaviours the sync depends on, including
 * Amplitude's silent no-op when a PUT names a category that does not exist.
 */
describe('sync.ts CLI', () => {
  const requests: Request[] = [];
  let events = new Map<string, FakeEvent>();
  let categories = new Set<string>();
  /** Names whose POST answers 409 (an event created between our GET and POST). */
  let conflictOnCreate = new Set<string>();
  /** When true every write answers success but changes nothing. */
  let ignoreWrites = false;
  let host = '';

  const respond = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const handle = (method: string, url: string, body: string, res: http.ServerResponse) => {
    const form = new URLSearchParams(body);
    if (method === 'GET' && url === '/api/2/taxonomy/event') {
      respond(res, 200, { success: true, data: [...events.values()] });
    } else if (method === 'GET' && url === '/api/2/taxonomy/category') {
      respond(res, 200, { success: true, data: [...categories].map((name) => ({ name })) });
    } else if (method === 'POST' && url === '/api/2/taxonomy/category') {
      if (!ignoreWrites) {
        categories.add(form.get('category_name') ?? '');
      }
      respond(res, 200, { success: true });
    } else if (method === 'POST' && url === '/api/2/taxonomy/event') {
      const name = form.get('event_type') ?? '';
      if (conflictOnCreate.has(name) || events.has(name)) {
        events.set(name, events.get(name) ?? fakeEvent(name));
        respond(res, 409, { success: false, errors: [{ message: 'already exists' }] });
        return;
      }
      if (!ignoreWrites) {
        const category = form.get('category') ?? '';
        events.set(
          name,
          fakeEvent(name, {
            description: form.get('description'),
            category: categories.has(category) ? { name: category } : null,
          }),
        );
      }
      respond(res, 200, { success: true });
    } else if (method === 'PUT' && url.startsWith('/api/2/taxonomy/event/')) {
      const name = decodeURIComponent(url.slice('/api/2/taxonomy/event/'.length));
      const event = events.get(name);
      if (!event) {
        respond(res, 404, { success: false, errors: [{ message: 'not a planned event' }] });
        return;
      }
      const category = form.get('category');
      if (ignoreWrites || (category !== null && !categories.has(category))) {
        respond(res, 200, { success: true });
        return;
      }
      const description = form.get('description');
      const tags = form.get('tags');
      const displayName = form.get('display_name');
      Object.assign(event, {
        ...(description !== null && { description }),
        ...(category !== null && { category: { name: category } }),
        ...(tags !== null && { tags: tags ? tags.split(',') : [] }),
        // eslint-disable-next-line camelcase
        ...(displayName !== null && { display_name: displayName || null }),
      });
      respond(res, 200, { success: true });
    } else {
      respond(res, 405, { success: false, errors: [{ message: `unexpected ${method} ${url}` }] });
    }
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const method = req.method ?? '';
      const url = req.url ?? '';
      requests.push({ method, url, body, authorization: req.headers.authorization });
      handle(method, url, body, res);
    });
  });
  const amplitudeEnv = () => ({
    AMPLITUDE_API_KEY: 'test-key',
    AMPLITUDE_SECRET_KEY: 'test-secret',
    AMPLITUDE_HOST: host,
  });
  const requestLines = () => requests.map((r) => `${r.method} ${decodeURIComponent(r.url)}`);

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
  });
  beforeEach(() => {
    requests.length = 0;
    events = new Map();
    categories = new Set(['Other']);
    conflictOnCreate = new Set();
    ignoreWrites = false;
  });

  it('--validate passes on the tracked catalogs', async () => {
    const { code, stdout } = await run(['--validate']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /TEST Sync Test A/);
    assert.match(stdout, /Validation passed/);
  });

  it('--validate fails on a broken catalog and writes the step summary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-sync-'));
    const catalog = path.join(dir, 'broken.events.catalog.ts');
    const summary = path.join(dir, 'summary.md');
    fs.writeFileSync(
      catalog,
      [
        "import type { EventCatalog } from '@odh-dashboard/analytics/catalog';",
        'export const brokenEvents = {',
        "  SHORT: { name: 'Short', description: 'Too short', category: 'X' },",
        "  TODO: { name: 'Todo', description: 'TODO write a real description', category: 'X' },",
        "  EMPTY: { name: '', description: 'Has no name at all, sadly', category: 'X' },",
        '} as const satisfies EventCatalog;',
      ].join('\n'),
    );
    try {
      const { code, stdout } = await run(['--validate', catalog], { GITHUB_STEP_SUMMARY: summary });
      assert.equal(code, 1);
      assert.match(stdout, /brokenEvents\.SHORT\): description is too short/);
      assert.match(stdout, /brokenEvents\.TODO\): description contains placeholder text "TODO"/);
      assert.match(stdout, /brokenEvents\.EMPTY\): name is empty/);
      assert.match(fs.readFileSync(summary, 'utf8'), /Validation failed with 3 error\(s\)/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--validate --base HEAD passes and reports what it compared with', async () => {
    const { code, stdout } = await run(['--validate', '--base', 'HEAD']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /Name-stability check against HEAD \([0-9a-f]{12}\): \d+ event\(s\)/);
  });

  it('--validate --base skips the check with a note when the ref does not exist', async () => {
    const { code, stdout } = await run(['--validate', '--base=refs/heads/no-such-branch-x9']);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /Base "refs\/heads\/no-such-branch-x9" not found; skipped/);
  });

  for (const [args, message] of [
    [['--validate', '--base'], /--base needs a git ref/],
    [['--validate', '--base', '--sync'], /--base needs a git ref/],
    [['--sync', '--base', 'HEAD'], /--base can only be used with --validate/],
    [['--validate', '--base', 'HEAD', 'a.events.catalog.ts'], /cannot be combined with file/],
  ] as const) {
    it(`rejects ${args.join(' ')}`, async () => {
      const { code, stderr } = await run([...args]);
      assert.equal(code, 2);
      assert.match(stderr, message);
    });
  }

  it('--sync without credentials exits non-zero with a clear message', async () => {
    const { code, stderr } = await run(['--sync']);
    assert.equal(code, 1);
    assert.match(
      stderr,
      /requires environment variable\(s\): AMPLITUDE_API_KEY, AMPLITUDE_SECRET_KEY/,
    );
  });

  it('rejects --dry-run without --sync', async () => {
    const { code, stderr } = await run(['--validate', '--dry-run']);
    assert.equal(code, 2);
    assert.match(stderr, /--dry-run can only be used with --sync/);
  });

  it('--sync --dry-run only reads', async () => {
    events.set('Legacy Event', fakeEvent('Legacy Event'));
    const { code, stdout } = await run(['--sync', '--dry-run'], amplitudeEnv());
    assert.equal(code, 0, stdout);
    assert.match(stdout, /DRY RUN/);
    assert.match(stdout, /To create: 3/);
    assert.match(stdout, /In Amplitude but in no catalog: 1/);
    assert.deepEqual(
      requests.map((r) => r.method),
      ['GET', 'GET'],
    );
    assert.equal(
      requests[0].authorization,
      `Basic ${Buffer.from('test-key:test-secret').toString('base64')}`,
    );
  });

  it('--sync writes sequentially, falls back to PUT on 409, verifies and never deletes', async () => {
    events.set(
      'TEST Sync Test C',
      fakeEvent('TEST Sync Test C', { description: 'outdated', category: { name: 'Other' } }),
    );
    conflictOnCreate.add('TEST Sync Test B');
    const { code, stdout } = await run(['--sync'], amplitudeEnv());
    assert.equal(code, 0, stdout);
    assert.deepEqual(requestLines(), [
      'GET /api/2/taxonomy/event',
      'GET /api/2/taxonomy/category',
      'POST /api/2/taxonomy/category',
      'POST /api/2/taxonomy/event',
      'PUT /api/2/taxonomy/event/TEST Sync Test A',
      'POST /api/2/taxonomy/event',
      'PUT /api/2/taxonomy/event/TEST Sync Test B',
      'PUT /api/2/taxonomy/event/TEST Sync Test C',
      'GET /api/2/taxonomy/event',
    ]);
    assert.equal(requests[2].body, 'category_name=TEST+Sync+Test');
    assert.equal(requests[4].body, 'tags=odh-catalog%2Cteam-maas');
    assert.match(requests[7].body, /^description=Test\+entry\+C.*&category=TEST\+Sync\+Test/);
    assert.doesNotMatch(stdout, /test-secret/);
    assert.match(stdout, /Created: 1/);
    assert.match(stdout, /Updated: 2/);
    assert.doesNotMatch(stdout, /VERIFICATION/);
    assert.deepEqual(events.get('TEST Sync Test A')?.tags, ['odh-catalog', 'team-maas']);
  });

  it('--sync fails when Amplitude reports success but does not apply the write', async () => {
    categories.add('TEST Sync Test');
    for (const name of ['TEST Sync Test A', 'TEST Sync Test B', 'TEST Sync Test C']) {
      events.set(name, fakeEvent(name, { description: 'old', category: { name: 'Other' } }));
    }
    ignoreWrites = true;
    const summary = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'amp-sync-')), 'summary.md');
    const { code, stdout } = await run(['--sync'], {
      ...amplitudeEnv(),
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.equal(code, 1, stdout);
    assert.match(stdout, /VERIFICATION failures: 3/);
    assert.match(
      stdout,
      /"TEST Sync Test A": write reported success but Amplitude shows description "old"/,
    );
    assert.match(fs.readFileSync(summary, 'utf8'), /### Verification failures/);
    fs.rmSync(path.dirname(summary), { recursive: true, force: true });
  });

  it('--sync does not create an event whose name differs only by case/space', async () => {
    categories.add('TEST Sync Test');
    events.set('TEST sync test a', fakeEvent('TEST sync test a'));
    const { code, stdout } = await run(['--sync'], amplitudeEnv());
    assert.equal(code, 1, stdout);
    assert.match(stdout, /CONFLICTS: 1/);
    assert.match(stdout, /"TEST Sync Test A" .* Amplitude already has "TEST sync test a"/);
    assert.ok(
      requests.every((r) => !(r.method === 'POST' && r.body.includes('TEST+Sync+Test+A'))),
      'must not POST the conflicting name',
    );

    requests.length = 0;
    const dryRun = await run(['--sync', '--dry-run'], amplitudeEnv());
    assert.equal(dryRun.code, 1, dryRun.stdout);
    assert.match(dryRun.stdout, /CONFLICTS: 1/);
  });
});
