import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, makeEvent, makeRename } from './fixtures.ts';
import type { CollectedEntry } from '../catalog.ts';
import {
  categoryName,
  computePlan,
  diffEvent,
  summarizeUntracked,
  type AmplitudeEvent,
} from '../plan.ts';

const entry = (name: string, description: string, category: string): CollectedEntry => ({
  file: 'packages/x/events.catalog.ts',
  exportName: 'xEvents',
  key: name.toUpperCase().replace(/\W/g, '_'),
  name,
  description,
  category,
  status: 'active',
  previousNames: [],
  tags: [],
});

const event = (
  name: string,
  description: string | null,
  category: AmplitudeEvent['category'],
  deleted = false,
): AmplitudeEvent => ({
  // eslint-disable-next-line camelcase
  event_type: name,
  description,
  category,
  // The sync tags every catalog event; events without the tag would always need an update.
  tags: ['odh-catalog'],
  deleted,
});

describe('categoryName', () => {
  it('handles object, string and null categories', () => {
    assert.equal(categoryName({ name: 'Forms' }), 'Forms');
    assert.equal(categoryName('Forms'), 'Forms');
    assert.equal(categoryName(null), '');
    assert.equal(categoryName(undefined), '');
    assert.equal(categoryName({ name: null }), '');
  });
});

describe('computePlan', () => {
  it('classifies entries as create, update or unchanged', () => {
    const plan = computePlan(
      [
        entry('New', 'Brand new event description', 'Forms'),
        entry('Same', 'Unchanged event description', 'Forms'),
        entry('Desc', 'Updated event description here', 'Forms'),
        entry('Cat', 'Category moved event description', 'Tables'),
        entry('NullCat', 'Event that had no category yet', 'Forms'),
      ],
      [
        event('Same', 'Unchanged event description', { name: 'Forms' }),
        event('Desc', 'Old description', { name: 'Forms' }),
        event('Cat', 'Category moved event description', { name: 'Forms' }),
        event('NullCat', 'Event that had no category yet', null),
      ],
      [{ id: 1, name: 'Forms' }],
    );

    assert.deepEqual(
      plan.create.map((e) => e.name),
      ['New'],
    );
    assert.deepEqual(
      plan.unchanged.map((e) => e.name),
      ['Same'],
    );
    assert.deepEqual(
      plan.update.map((u) => [u.entry.name, u.changes]),
      [
        ['Desc', { description: 'Updated event description here' }],
        ['Cat', { category: 'Tables' }],
        ['NullCat', { category: 'Forms' }],
      ],
    );
    assert.deepEqual(plan.update[0].current, {
      description: 'Old description',
      category: 'Forms',
      tags: ['odh-catalog'],
      displayName: null,
    });
    assert.deepEqual(plan.categoriesToCreate, ['Tables']);
  });

  it('treats a null description as empty and plans an update', () => {
    const plan = computePlan(
      [entry('E', 'A description for event E', 'Forms')],
      [event('E', null, { name: 'Forms' })],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(plan.update[0].changes, { description: 'A description for event E' });
    assert.deepEqual(plan.categoriesToCreate, []);
  });

  it('plans a create for an event that only exists as deleted', () => {
    const plan = computePlan(
      [entry('Gone', 'A description for event Gone', 'Forms')],
      [event('Gone', 'A description for event Gone', { name: 'Forms' }, true)],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(
      plan.create.map((e) => e.name),
      ['Gone'],
    );
  });

  it('only creates categories that the planned writes need', () => {
    const plan = computePlan(
      [entry('Same', 'Unchanged event description', 'Legacy')],
      [event('Same', 'Unchanged event description', { name: 'Legacy' })],
      [],
    );
    assert.deepEqual(plan.categoriesToCreate, []);
  });
});

describe('summarizeUntracked', () => {
  it('counts every untracked live event but lists only non built-ins, sorted', () => {
    const summary = summarizeUntracked(
      [
        event('Tracked', 'x', null),
        event('Zeta Clicked', 'x', null),
        event('Alpha Opened', 'x', null),
        event('[Amplitude] Page Viewed', 'x', null),
        event('session_start', 'x', null),
        event('Old Deleted', 'x', null, true),
      ],
      new Set(['Tracked']),
    );
    assert.deepEqual(summary, {
      total: 4,
      builtInCount: 2,
      listed: ['Alpha Opened', 'Zeta Clicked'],
    });
  });

  it('is also part of computePlan', () => {
    const plan = computePlan(
      [entry('Tracked', 'A description for Tracked', 'Forms')],
      [event('Tracked', 'A description for Tracked', { name: 'Forms' }), event('Other', '', null)],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(plan.untracked, { total: 1, builtInCount: 0, listed: ['Other'] });
  });
});

describe('computePlan lifecycle', () => {
  it('diffs description, category, tags (as a set) and managed display names', () => {
    const plan = computePlan(
      [
        makeEntry('Same', { tags: ['team-a', 'team-b'] }),
        makeEntry('Tags', { tags: ['team-a'] }),
        makeEntry('NullTags'),
        makeEntry('Display', { displayName: 'Nice display' }),
        makeEntry('Unmanaged Display'),
      ],
      [
        makeEvent('Same', { tags: ['team-b', 'odh-catalog', 'team-a'] }),
        makeEvent('Tags', { tags: ['odh-catalog', 'manual-tag'] }),
        makeEvent('NullTags', { tags: null }),
        // eslint-disable-next-line camelcase
        makeEvent('Display', { display_name: 'Old display' }),
        // eslint-disable-next-line camelcase
        makeEvent('Unmanaged Display', { display_name: 'Set in Amplitude' }),
      ],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(
      plan.unchanged.map((e) => e.name),
      ['Same', 'Unmanaged Display'],
    );
    assert.deepEqual(
      plan.update.map((u) => [u.entry.name, u.changes]),
      [
        ['Tags', { tags: ['odh-catalog', 'team-a'] }],
        ['NullTags', { tags: ['odh-catalog'] }],
        ['Display', { displayName: 'Nice display' }],
      ],
    );
  });

  it('updates shipped deprecated/removed events and skips never-shipped ones', () => {
    const plan = computePlan(
      [
        makeEntry('Old', { status: 'deprecated', deprecated: { since: '3.2', reason: 'Unused' } }),
        makeEntry('Never Deprecated', {
          status: 'deprecated',
          deprecated: { since: '3.2', reason: 'Unused' },
        }),
        makeEntry('Never Removed', { status: 'removed', removedIn: '3.3' }),
        makeEntry('Deleted Removed', { status: 'removed', removedIn: '3.3' }),
        makeEntry('Active'),
      ],
      [makeEvent('Old'), makeEvent('Deleted Removed', { deleted: true })],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(
      plan.skipped.map((e) => e.name),
      ['Never Deprecated', 'Never Removed', 'Deleted Removed'],
    );
    assert.deepEqual(
      plan.create.map((e) => e.name),
      ['Active'],
    );
    assert.deepEqual(plan.update[0].changes, {
      description: '[DEPRECATED since 3.2: Unused] Fired when Old happens in the UI.',
      tags: ['deprecated', 'odh-catalog'],
    });
    assert.deepEqual(plan.lifecycle, { active: 1, deprecated: 2, removed: 2 });
  });

  it('records a conflict instead of creating a case/space variant of a live event', () => {
    const plan = computePlan(
      [makeEntry('TEST Sync Test B', { category: 'New Cat' }), makeEntry('Fresh')],
      [
        makeEvent('TEST sync test b'),
        makeEvent('TEST Sync Test B '),
        makeEvent('fresh', { deleted: true }),
      ],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(
      plan.conflicts.map((c) => [c.entry.name, c.existing]),
      [['TEST Sync Test B', ['TEST sync test b', 'TEST Sync Test B ']]],
    );
    assert.deepEqual(
      plan.create.map((e) => e.name),
      ['Fresh'],
    );
    assert.deepEqual(plan.categoriesToCreate, []);
  });

  it('lists old names that still exist in Amplitude as history to stitch', () => {
    const [oldA, newA] = makeRename('Old A', 'New A');
    const oldB = makeEntry('Old B', {
      status: 'removed',
      removedIn: '3.0',
      deprecated: { since: '2.0', reason: 'Renamed', replacedBy: 'New A' },
    });
    const plan = computePlan(
      [oldA, { ...newA, previousNames: ['Old A', 'Old B'] }, oldB],
      [makeEvent('Old A'), makeEvent('New A')],
      [{ name: 'Forms' }],
    );
    assert.deepEqual(plan.history, [{ oldName: 'Old A', newName: 'New A' }]);
    assert.deepEqual(
      plan.skipped.map((e) => e.name),
      ['Old B'],
    );
  });
});

describe('diffEvent', () => {
  it('returns nothing when the current state matches', () => {
    assert.deepEqual(
      diffEvent(
        { description: 'd', category: 'c', tags: ['a', 'b'], displayName: 'x' },
        { description: 'd', category: 'c', tags: ['b', 'a'], displayName: 'x' },
      ),
      {},
    );
  });

  it('never clears a display name the catalog does not set', () => {
    assert.deepEqual(
      diffEvent(
        { description: 'd', category: 'c', tags: [] },
        { description: 'd', category: 'c', tags: [], displayName: 'Set by hand' },
      ),
      {},
    );
  });
});
