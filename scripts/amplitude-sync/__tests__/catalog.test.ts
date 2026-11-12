import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  collectEntries,
  dedupeEntries,
  loadCatalogModules,
  validateEntries,
  type CollectedEntry,
} from '../catalog.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const VALID_DESCRIPTION = 'Fired when the user saves the form.';

const entry = (overrides: Partial<CollectedEntry> = {}): CollectedEntry => ({
  file: 'packages/x/events.catalog.ts',
  exportName: 'xEvents',
  key: 'SAVE',
  name: 'Form Saved',
  description: VALID_DESCRIPTION,
  category: 'Forms',
  status: 'active',
  previousNames: [],
  tags: [],
  ...overrides,
});

describe('collectEntries', () => {
  it('collects entries from every exported object and ignores non-object exports', () => {
    const { entries, errors } = collectEntries([
      {
        file: 'a/events.catalog.ts',
        exports: {
          version: 2,
          aEvents: { ONE: { name: 'One', description: VALID_DESCRIPTION, category: 'A' } },
          moreEvents: { TWO: { name: 'Two', description: VALID_DESCRIPTION, category: 'A' } },
        },
      },
    ]);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      entries.map((e) => `${e.exportName}.${e.key}=${e.name}`),
      ['aEvents.ONE=One', 'moreEvents.TWO=Two'],
    );
  });

  it('reports non-object entries and files without entries', () => {
    const { errors } = collectEntries([
      { file: 'a/events.catalog.ts', exports: { aEvents: { BAD: 'nope' } } },
      { file: 'b/events.catalog.ts', exports: { label: 'x' } },
    ]);
    assert.equal(errors.length, 3);
    assert.match(errors[0], /a\/events\.catalog\.ts \(aEvents\.BAD\): entry must be an object/);
    assert.match(errors[1], /a\/events\.catalog\.ts: no catalog entries found/);
    assert.match(errors[2], /b\/events\.catalog\.ts: no catalog entries found/);
  });

  it('turns non-string fields into empty strings so validation flags them', () => {
    const { entries } = collectEntries([
      { file: 'a/events.catalog.ts', exports: { e: { K: { name: 1, description: null } } } },
    ]);
    assert.deepEqual(validateEntries(entries), [
      'a/events.catalog.ts (e.K): name is empty or not a string',
      'a/events.catalog.ts (e.K): description is empty or not a string',
      'a/events.catalog.ts (e.K): category is empty or not a string',
    ]);
  });
});

describe('validateEntries', () => {
  it('accepts a valid entry', () => {
    assert.deepEqual(validateEntries([entry()]), []);
  });

  for (const field of ['name', 'description', 'category'] as const) {
    it(`rejects an empty ${field} and names file and key`, () => {
      const errors = validateEntries([entry({ [field]: '  ' })]);
      assert.ok(
        errors.includes(
          `packages/x/events.catalog.ts (xEvents.SAVE): ${field} is empty or not a string`,
        ),
        errors.join('\n'),
      );
    });
  }

  it('rejects leading or trailing whitespace', () => {
    assert.deepEqual(validateEntries([entry({ name: 'Form Saved ' })]), [
      'packages/x/events.catalog.ts (xEvents.SAVE): name has leading or trailing whitespace',
    ]);
  });

  it('rejects descriptions shorter than 20 characters', () => {
    const errors = validateEntries([entry({ description: 'Saves the form.' })]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /description is too short \(15 chars, minimum 20\)/);
  });

  for (const word of ['TODO', 'tbd', 'FixMe']) {
    it(`rejects the placeholder "${word}" case-insensitively`, () => {
      const errors = validateEntries([
        entry({ description: `${word}: describe what this event means` }),
      ]);
      assert.equal(errors.length, 1);
      assert.match(errors[0], new RegExp(`placeholder text "${word}"`));
    });
  }

  it('only matches placeholders as whole words', () => {
    assert.deepEqual(
      validateEntries([entry({ description: 'Opens the TODOS list on the page.' })]),
      [],
    );
  });

  it('rejects the same event name with a different description or category', () => {
    const errors = validateEntries([
      entry(),
      entry({ file: 'packages/y/events.catalog.ts', key: 'OTHER', category: 'Other' }),
      entry({ key: 'THIRD', description: 'A different but long description.' }),
    ]);
    assert.equal(errors.length, 2);
    assert.match(
      errors[0],
      /^Event "Form Saved" is defined more than once .*packages\/x\/events\.catalog\.ts \(xEvents\.SAVE\) and packages\/y\/events\.catalog\.ts \(xEvents\.OTHER\)$/,
    );
    assert.match(errors[1], /xEvents\.THIRD/);
  });

  it('allows identical duplicates and dedupes them', () => {
    const entries = [entry(), entry({ file: 'packages/y/events.catalog.ts', key: 'COPY' })];
    assert.deepEqual(validateEntries(entries), []);
    assert.deepEqual(dedupeEntries(entries), [entries[0]]);
  });
});

describe('loadCatalogModules', () => {
  it('loads the real maas catalog through Node type stripping', async () => {
    const file = 'packages/maas/frontend/src/app/tracking/events.catalog.ts';
    const { modules, errors } = await loadCatalogModules(REPO_ROOT, [file]);
    assert.deepEqual(errors, []);
    const { entries } = collectEntries(modules);
    assert.deepEqual(validateEntries(entries), []);
    assert.ok(entries.length > 0);
    assert.ok(entries.every((e) => e.name.startsWith('TEST ')));
  });

  it('reports files that fail to load instead of throwing', async () => {
    const { modules, errors } = await loadCatalogModules(REPO_ROOT, ['does/not/exist.ts']);
    assert.deepEqual(modules, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^does\/not\/exist\.ts: failed to load/);
  });
});
