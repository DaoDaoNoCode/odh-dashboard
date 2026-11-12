import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, makeEvent, memoryClient } from './fixtures.ts';
import { executePlan } from '../execute.ts';
import { computePlan } from '../plan.ts';
import { verifyWrites } from '../verify.ts';

describe('executePlan with lifecycle fields', () => {
  it('creates, then sets tags and the display name with a PUT', async () => {
    const entries = [makeEntry('New', { tags: ['team-a'], displayName: 'Nice new' })];
    const { client, calls, events } = memoryClient([], ['Forms']);
    const result = await executePlan(computePlan(entries, [], [{ name: 'Forms' }]), client);

    assert.deepEqual(calls, ['createEvent New', 'updateEvent New tags,displayName']);
    assert.deepEqual(result, {
      categoriesCreated: [],
      created: ['New'],
      updated: [],
      failures: [],
    });
    assert.deepEqual(events.get('New')?.tags, ['odh-catalog', 'team-a']);
    // eslint-disable-next-line camelcase
    assert.equal(events.get('New')?.display_name, 'Nice new');
  });

  it('records a failed follow-up PUT after a successful create', async () => {
    const { client } = memoryClient([], ['Forms'], { failUpdates: ['New'] });
    const result = await executePlan(
      computePlan([makeEntry('New')], [], [{ name: 'Forms' }]),
      client,
    );
    assert.deepEqual(result.created, ['New']);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /^created, but setting tags\/display name failed/);
  });

  it('skips every write that needs a category that could not be created', async () => {
    const entries = [
      makeEntry('Create Broken', { category: 'Broken' }),
      makeEntry('Move Broken', { category: 'Broken' }),
      makeEntry('Create Ok', { category: 'Ok' }),
      makeEntry('Create Existing', { category: 'Exists' }),
      makeEntry('Text Only'),
    ];
    const live = [makeEvent('Move Broken'), makeEvent('Text Only', { description: 'old' })];
    const plan = computePlan(entries, live, [{ name: 'Forms' }]);
    assert.deepEqual(plan.categoriesToCreate, ['Broken', 'Exists', 'Ok']);
    const { client, calls } = memoryClient(live, ['Forms'], {
      failCategories: { Broken: 400, Exists: 409 },
    });
    const result = await executePlan(plan, client);

    assert.deepEqual(calls, [
      'createCategory Broken',
      'createCategory Exists',
      'createCategory Ok',
      'createEvent Create Ok',
      'updateEvent Create Ok tags',
      'createEvent Create Existing',
      'updateEvent Create Existing tags',
      'updateEvent Text Only description',
    ]);
    assert.deepEqual(result.categoriesCreated, ['Ok']);
    assert.deepEqual(result.created, ['Create Ok', 'Create Existing']);
    assert.deepEqual(result.updated, ['Text Only']);
    assert.deepEqual(
      result.failures.map((f) => [f.action, f.name]),
      [
        ['create-category', 'Broken'],
        ['create', 'Create Broken'],
        ['update', 'Move Broken'],
      ],
    );
    assert.match(result.failures[1].message, /^skipped: category "Broken" could not be created/);
  });
});

describe('verifyWrites', () => {
  const entries = [
    makeEntry('New', { tags: ['team-a'], displayName: 'Nice new' }),
    makeEntry('Changed', { category: 'Tables' }),
    makeEntry('Same'),
  ];
  const live = [makeEvent('Changed', { description: 'old' }), makeEvent('Same')];
  const categories = [{ name: 'Forms' }, { name: 'Tables' }];

  it('passes when Amplitude applied every write', async () => {
    const plan = computePlan(entries, live, categories);
    const { client } = memoryClient(live, ['Forms', 'Tables']);
    const result = await executePlan(plan, client);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(verifyWrites(plan, result, await client.listEvents()), []);
  });

  it('catches a silent no-op: success responses but nothing changed', async () => {
    const plan = computePlan(entries, live, categories);
    const { client } = memoryClient(live, ['Forms', 'Tables'], { ignoreUpdates: true });
    const result = await executePlan(plan, client);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.created, ['New']);
    assert.deepEqual(result.updated, ['Changed']);

    assert.deepEqual(verifyWrites(plan, result, await client.listEvents()), [
      {
        name: 'New',
        message:
          'write reported success but Amplitude shows tags [] (expected [odh-catalog, team-a]); ' +
          'display name none (expected "Nice new")',
      },
      {
        name: 'Changed',
        message:
          'write reported success but Amplitude shows description "old" ' +
          '(expected "Fired when Changed happens in the UI."); category "Forms" (expected "Tables")',
      },
    ]);
  });

  it('compares tags as a set and reports tag and display name mismatches', () => {
    const plan = computePlan([makeEntry('A', { tags: ['team-b'], displayName: 'Nice' })], [], []);
    const result = { categoriesCreated: [], created: ['A'], updated: [], failures: [] };
    assert.deepEqual(
      verifyWrites(plan, result, [
        // eslint-disable-next-line camelcase
        makeEvent('A', { tags: ['team-b', 'odh-catalog'], display_name: 'Nice' }),
      ]),
      [],
    );
    assert.deepEqual(
      // eslint-disable-next-line camelcase
      verifyWrites(plan, result, [makeEvent('A', { tags: ['odh-catalog'], display_name: null })]),
      [
        {
          name: 'A',
          message:
            'write reported success but Amplitude shows tags [odh-catalog] ' +
            '(expected [odh-catalog, team-b]); display name none (expected "Nice")',
        },
      ],
    );
  });

  it('reports a written event that Amplitude does not list', () => {
    const plan = computePlan([makeEntry('A')], [], []);
    const result = { categoriesCreated: [], created: ['A'], updated: [], failures: [] };
    assert.deepEqual(verifyWrites(plan, result, []), [
      { name: 'A', message: 'write reported success but Amplitude shows no event named "A"' },
    ]);
  });

  it('skips events whose write already failed and ignores deleted copies', () => {
    const plan = computePlan([makeEntry('A'), makeEntry('B')], [], []);
    const result = {
      categoriesCreated: [],
      created: ['A', 'B'],
      updated: [],
      failures: [{ action: 'update' as const, name: 'A', message: 'boom' }],
    };
    assert.deepEqual(
      verifyWrites(plan, result, [makeEvent('B', { deleted: true })]).map((f) => f.name),
      ['B'],
    );
  });
});
