import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, makeRename } from './fixtures.ts';
import { collectEntries, validateEntries, type CollectedEntry } from '../catalog.ts';
import {
  DESCRIPTION_MAX_LENGTH,
  desiredState,
  effectiveDescription,
  effectiveTags,
  normalizeName,
} from '../lifecycle.ts';

const WHERE = 'packages/x/events.catalog.ts (xEvents.FORM_SAVED)';

/** Asserts that validation reports exactly the given messages (order-insensitive). */
const assertErrors = (entries: CollectedEntry[], expected: (string | RegExp)[]) => {
  const errors = validateEntries(entries);
  assert.equal(errors.length, expected.length, errors.join('\n'));
  for (const pattern of expected) {
    assert.ok(
      errors.some((e) => (typeof pattern === 'string' ? e === pattern : pattern.test(e))),
      `missing ${String(pattern)} in:\n${errors.join('\n')}`,
    );
  }
};

const deprecatedEntry = (overrides: Partial<CollectedEntry> = {}) =>
  makeEntry('Form Saved', {
    status: 'deprecated',
    deprecated: { since: '3.2', reason: 'The form was replaced' },
    ...overrides,
  });

describe('collectEntries lifecycle fields', () => {
  it('reads every lifecycle field and defaults status, previousNames and tags', () => {
    const { entries, errors } = collectEntries([
      {
        file: 'a/events.catalog.ts',
        exports: {
          aEvents: {
            OLD: {
              name: 'Old',
              description: 'Old event that was renamed later.',
              category: 'A',
              status: 'removed',
              removedIn: '3.4',
              deprecated: { since: '3.2', reason: 'Renamed', replacedBy: 'New' },
            },
            NEW: {
              name: 'New',
              description: 'New name of the old event, still sent.',
              category: 'A',
              previousNames: ['Old'],
              displayName: 'New thing',
              tags: ['team-a'],
              properties: { id: 'the id' },
            },
            PLAIN: { name: 'Plain', description: 'A plain event description.', category: 'A' },
          },
        },
      },
    ]);
    assert.deepEqual(errors, []);
    assert.deepEqual(entries, [
      {
        file: 'a/events.catalog.ts',
        exportName: 'aEvents',
        key: 'OLD',
        name: 'Old',
        description: 'Old event that was renamed later.',
        category: 'A',
        status: 'removed',
        deprecated: { since: '3.2', reason: 'Renamed', replacedBy: 'New' },
        removedIn: '3.4',
        previousNames: [],
        tags: [],
      },
      {
        file: 'a/events.catalog.ts',
        exportName: 'aEvents',
        key: 'NEW',
        name: 'New',
        description: 'New name of the old event, still sent.',
        category: 'A',
        status: 'active',
        previousNames: ['Old'],
        displayName: 'New thing',
        tags: ['team-a'],
      },
      {
        file: 'a/events.catalog.ts',
        exportName: 'aEvents',
        key: 'PLAIN',
        name: 'Plain',
        description: 'A plain event description.',
        category: 'A',
        status: 'active',
        previousNames: [],
        tags: [],
      },
    ]);
    assert.deepEqual(validateEntries(entries), []);
  });

  it('reports wrong types, owner and unknown fields', () => {
    const { errors } = collectEntries([
      {
        file: 'a/events.catalog.ts',
        exports: {
          e: {
            K: {
              name: 'Bad Types',
              description: 'An event with badly typed fields.',
              category: 'A',
              status: 1,
              deprecated: 'yes',
              removedIn: 3,
              previousNames: 'Old',
              displayName: false,
              tags: ['ok', 2],
              owner: 'someone',
              descripton: 'typo',
            },
            L: {
              name: 'Bad Replacement',
              description: 'An event with a bad replacedBy.',
              category: 'A',
              status: 'deprecated',
              deprecated: { since: '1', reason: 'r', replacedBy: 5 },
            },
          },
        },
      },
    ]);
    const where = 'a/events.catalog.ts (e.K)';
    assert.deepEqual(errors.toSorted(), [
      `${where}: deprecated must be an object with since and reason`,
      `${where}: displayName must be a string`,
      `${where}: owner is not supported (Amplitude only accepts existing users); use a tag such as 'team-maas' instead`,
      `${where}: previousNames must be an array of strings`,
      `${where}: removedIn must be a string`,
      `${where}: status must be a string`,
      `${where}: tags must be an array of strings`,
      `${where}: unknown field "descripton"`,
      'a/events.catalog.ts (e.L): deprecated.replacedBy must be a string',
    ]);
  });
});

describe('validateEntries status rules', () => {
  it('accepts deprecated and removed entries', () => {
    assertErrors(
      [
        deprecatedEntry(),
        makeEntry('Gone', { status: 'removed', removedIn: '2026-01-31' }),
        makeEntry('Gone Too', {
          status: 'removed',
          removedIn: '3.0',
          deprecated: { since: '2.9', reason: 'Unused' },
        }),
      ],
      [],
    );
  });

  it('rejects an unknown status', () => {
    assertErrors(
      [makeEntry('Form Saved', { status: 'retired' })],
      [`${WHERE}: status "retired" must be one of active, deprecated, removed`],
    );
  });

  it("requires deprecated: { since, reason } for status 'deprecated'", () => {
    assertErrors(
      [makeEntry('Form Saved', { status: 'deprecated' })],
      [`${WHERE}: status 'deprecated' requires deprecated: { since, reason }`],
    );
  });

  it('requires a non-empty since and reason', () => {
    assertErrors(
      [deprecatedEntry({ deprecated: { since: ' ', reason: '' } })],
      [
        `${WHERE}: deprecated.since is empty or not a string`,
        `${WHERE}: deprecated.reason is empty or not a string`,
      ],
    );
  });

  it('rejects deprecated on an active entry', () => {
    assertErrors(
      [makeEntry('Form Saved', { deprecated: { since: '1', reason: 'x' } })],
      [`${WHERE}: deprecated is only allowed with status 'deprecated' or 'removed'`],
    );
  });

  it("requires removedIn for status 'removed'", () => {
    assertErrors(
      [makeEntry('Form Saved', { status: 'removed' })],
      [`${WHERE}: status 'removed' requires removedIn (release, version or ISO date)`],
    );
  });

  it('rejects removedIn unless the status is removed', () => {
    assertErrors(
      [makeEntry('Form Saved', { removedIn: '3.0' })],
      [`${WHERE}: removedIn is only allowed with status 'removed'`],
    );
    assertErrors(
      [deprecatedEntry({ removedIn: '3.0' })],
      [`${WHERE}: removedIn is only allowed with status 'removed'`],
    );
  });

  it('treats differing lifecycle fields as a conflicting duplicate', () => {
    assertErrors(
      [makeEntry('Form Saved'), deprecatedEntry({ key: 'COPY' })],
      [/^Event "Form Saved" is defined more than once with different values/],
    );
  });
});

describe('validateEntries replacedBy', () => {
  it('accepts a replacement that is an active entry', () => {
    assertErrors(makeRename('Old Saved', 'Form Saved'), []);
  });

  it('rejects a replacement that is not in the catalog', () => {
    assertErrors(
      [deprecatedEntry({ deprecated: { since: '1', reason: 'r', replacedBy: 'Nope' } })],
      [`${WHERE}: deprecated.replacedBy "Nope" is not in the catalog`],
    );
  });

  it('rejects a replacement that is not active', () => {
    assertErrors(
      [
        deprecatedEntry({ deprecated: { since: '1', reason: 'r', replacedBy: 'Gone' } }),
        makeEntry('Gone', { status: 'removed', removedIn: '2.0' }),
      ],
      [`${WHERE}: deprecated.replacedBy "Gone" has status 'removed'; it must name an active event`],
    );
  });

  it('rejects an entry that replaces itself', () => {
    assertErrors(
      [deprecatedEntry({ deprecated: { since: '1', reason: 'r', replacedBy: 'Form Saved' } })],
      [`${WHERE}: deprecated.replacedBy cannot name the event itself`],
    );
  });
});

describe('validateEntries previousNames', () => {
  const NEW_WHERE = 'packages/x/events.catalog.ts (xEvents.FORM_SUBMITTED)';

  it('rejects an old name that is not kept in the catalog', () => {
    assertErrors(
      [makeEntry('Form Submitted', { previousNames: ['Form Saved'] })],
      [
        `${NEW_WHERE}: previousNames "Form Saved" is not in the catalog. Keep the old event as an ` +
          `entry with status 'deprecated' (or 'removed') and deprecated.replacedBy "Form Submitted"`,
      ],
    );
  });

  it('rejects an old name whose entry is still active', () => {
    assertErrors(
      [makeEntry('Form Saved'), makeEntry('Form Submitted', { previousNames: ['Form Saved'] })],
      [
        `${NEW_WHERE}: previousNames "Form Saved" has status 'active'; it must be 'deprecated' or 'removed'`,
      ],
    );
  });

  it('rejects an old name that points to a different replacement', () => {
    assertErrors(
      [
        deprecatedEntry({ deprecated: { since: '1', reason: 'r', replacedBy: 'Form Sent' } }),
        makeEntry('Form Sent'),
        makeEntry('Form Submitted', { previousNames: ['Form Saved'] }),
      ],
      [`${NEW_WHERE}: previousNames "Form Saved" must set deprecated.replacedBy "Form Submitted"`],
    );
  });

  it('accepts a removed old name that points to the new name', () => {
    assertErrors(
      [
        makeEntry('Form Saved', {
          status: 'removed',
          removedIn: '3.4',
          deprecated: { since: '3.2', reason: 'Renamed', replacedBy: 'Form Submitted' },
        }),
        makeEntry('Form Submitted', { previousNames: ['Form Saved'] }),
      ],
      [],
    );
  });

  it('rejects an entry that lists itself', () => {
    assertErrors(
      [makeEntry('Form Saved', { previousNames: ['Form Saved'] })],
      [`${WHERE}: previousNames cannot list the event itself`],
    );
  });

  it('rejects an old name listed by two entries or twice by one', () => {
    const [old, renamed] = makeRename('Form Saved', 'Form Submitted');
    assertErrors(
      [old, renamed, makeEntry('Form Sent', { previousNames: ['Form Saved'] })],
      ['"Form Saved" is listed in previousNames of both "Form Submitted" and "Form Sent"'],
    );
    assertErrors(
      [old, { ...renamed, previousNames: ['Form Saved', 'Form Saved'] }],
      [`${NEW_WHERE}: previousNames lists "Form Saved" more than once`],
    );
  });
});

describe('validateEntries names, tags and display names', () => {
  it('rejects names that only differ by case or whitespace', () => {
    assertErrors(
      [makeEntry('Form Saved'), makeEntry('form  saved', { key: 'LOWER' })],
      [
        'Events "Form Saved" (packages/x/events.catalog.ts (xEvents.FORM_SAVED)), "form  saved" ' +
          '(packages/x/events.catalog.ts (xEvents.LOWER)) would create separate Amplitude events ' +
          'that differ only by case/space',
      ],
    );
  });

  it('accepts names that differ by more than case or whitespace', () => {
    assertErrors([makeEntry('Form Saved'), makeEntry('Form Saved 2')], []);
  });

  it('accepts lowercase kebab-case tags', () => {
    assertErrors([makeEntry('Form Saved', { tags: ['team-maas', 'v2', 'a-b-c'] })], []);
  });

  for (const tag of ['Team-MaaS', 'team_maas', 'team--maas', '-team', 'team-', 'team maas', '']) {
    it(`rejects the tag ${JSON.stringify(tag)}`, () => {
      assertErrors(
        [makeEntry('Form Saved', { tags: [tag] })],
        [`${WHERE}: tag "${tag}" must be lowercase kebab-case (e.g. team-maas)`],
      );
    });
  }

  for (const tag of ['odh-catalog', 'deprecated', 'removed', 'renamed']) {
    it(`rejects the managed tag "${tag}"`, () => {
      assertErrors(
        [makeEntry('Form Saved', { tags: [tag] })],
        [`${WHERE}: tag "${tag}" is set by the sync; remove it from tags`],
      );
    });
  }

  it('rejects duplicate tags', () => {
    assertErrors(
      [makeEntry('Form Saved', { tags: ['team-a', 'team-a'] })],
      [`${WHERE}: tags contain duplicates`],
    );
  });

  it('accepts a display name and rejects empty or untrimmed ones', () => {
    assertErrors([makeEntry('Form Saved', { displayName: 'Form saved' })], []);
    assertErrors(
      [makeEntry('Form Saved', { displayName: '' })],
      [`${WHERE}: displayName is empty or not a string`],
    );
    assertErrors(
      [makeEntry('Form Saved', { displayName: 'Form saved ' })],
      [`${WHERE}: displayName has leading or trailing whitespace`],
    );
  });
});

describe('validateEntries description length', () => {
  const withEffectiveLength = (length: number) => {
    const base = deprecatedEntry({ description: '' });
    const overhead = effectiveDescription(base).length;
    return deprecatedEntry({ description: 'x'.repeat(length - overhead) });
  };

  it(`accepts an effective description of exactly ${DESCRIPTION_MAX_LENGTH} characters`, () => {
    const entry = withEffectiveLength(DESCRIPTION_MAX_LENGTH);
    assert.equal(effectiveDescription(entry).length, DESCRIPTION_MAX_LENGTH);
    assertErrors([entry], []);
  });

  it('counts the lifecycle prefix towards the limit', () => {
    assertErrors(
      [withEffectiveLength(DESCRIPTION_MAX_LENGTH + 1)],
      [
        `${WHERE}: description with the lifecycle prefix/suffix is 4097 chars; Amplitude allows at most 4096`,
      ],
    );
  });
});

describe('effectiveDescription', () => {
  it('leaves active descriptions alone', () => {
    assert.equal(
      effectiveDescription(makeEntry('A', { description: 'Plain text.' })),
      'Plain text.',
    );
  });

  it('prefixes deprecated events, with and without a replacement', () => {
    assert.equal(
      effectiveDescription(
        makeEntry('A', {
          description: 'Old form saved.',
          status: 'deprecated',
          deprecated: { since: '3.2', reason: 'Replaced by the wizard', replacedBy: 'B' },
        }),
      ),
      '[DEPRECATED since 3.2: Replaced by the wizard. Use "B" instead] Old form saved.',
    );
    assert.equal(
      effectiveDescription(
        makeEntry('A', {
          description: 'Old form saved.',
          status: 'deprecated',
          deprecated: { since: '2026-01-31', reason: 'Feature retired' },
        }),
      ),
      '[DEPRECATED since 2026-01-31: Feature retired] Old form saved.',
    );
  });

  it('prefixes removed events, with and without a replacement', () => {
    assert.equal(
      effectiveDescription(
        makeEntry('A', {
          description: 'Old form saved.',
          status: 'removed',
          removedIn: '3.4',
          deprecated: { since: '3.2', reason: 'Renamed', replacedBy: 'B' },
        }),
      ),
      '[REMOVED in 3.4. Replaced by "B"] Old form saved.',
    );
    assert.equal(
      effectiveDescription(
        makeEntry('A', { description: 'Old form saved.', status: 'removed', removedIn: '3.4' }),
      ),
      '[REMOVED in 3.4] Old form saved.',
    );
  });

  it('appends the previous names', () => {
    assert.equal(
      effectiveDescription(
        makeEntry('C', { description: 'Form submitted.', previousNames: ['A', 'B'] }),
      ),
      'Form submitted.\n\nPreviously sent as: "A", "B". Merge them in Amplitude Data to keep one history.',
    );
  });
});

describe('effectiveTags and desiredState', () => {
  it('adds odh-catalog and the lifecycle tags, sorted and unique', () => {
    assert.deepEqual(effectiveTags(makeEntry('A', { tags: ['team-z', 'team-a'] })), [
      'odh-catalog',
      'team-a',
      'team-z',
    ]);
    assert.deepEqual(effectiveTags(deprecatedEntry()), ['deprecated', 'odh-catalog']);
    assert.deepEqual(effectiveTags(makeEntry('A', { status: 'removed', removedIn: '1' })), [
      'odh-catalog',
      'removed',
    ]);
    assert.deepEqual(effectiveTags(makeEntry('A', { previousNames: ['B'] })), [
      'odh-catalog',
      'renamed',
    ]);
  });

  it('only includes a display name when the entry sets one', () => {
    assert.equal('displayName' in desiredState(makeEntry('A')), false);
    assert.deepEqual(desiredState(makeEntry('A', { displayName: 'Nice A', category: 'Cat' })), {
      description: 'Fired when A happens in the UI.',
      category: 'Cat',
      tags: ['odh-catalog'],
      displayName: 'Nice A',
    });
  });
});

describe('normalizeName', () => {
  it('lowercases, trims and collapses whitespace', () => {
    assert.equal(normalizeName('  TEST Sync\t Test  B '), 'test sync test b');
    assert.equal(normalizeName('TEST Sync Test B'), normalizeName('TEST sync test b '));
  });
});
