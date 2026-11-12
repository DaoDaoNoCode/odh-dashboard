import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CollectedEntry } from '../catalog.ts';
import { categoryName, computePlan, summarizeUntracked, type AmplitudeEvent } from '../plan.ts';

const entry = (name: string, description: string, category: string): CollectedEntry => ({
  file: 'packages/x/events.catalog.ts',
  exportName: 'xEvents',
  key: name.toUpperCase().replace(/\W/g, '_'),
  name,
  description,
  category,
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
    assert.deepEqual(plan.update[0].current, { description: 'Old description', category: 'Forms' });
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
