// Shared test builders (not a test file: node --test only runs *.test.ts).
import { AmplitudeApiError, type AmplitudeClient } from '../amplitude.ts';
import type { CollectedEntry } from '../catalog.ts';
import type { AmplitudeEvent } from '../plan.ts';

type MemoryClientOptions = {
  /** PUTs answer success but change nothing (Amplitude's silent no-op). */
  ignoreUpdates?: boolean;
  /** Category names whose creation fails with this HTTP status. */
  failCategories?: Record<string, number>;
  /** Event names whose PUT fails with HTTP 400. */
  failUpdates?: string[];
};

/** In-memory AmplitudeClient that records calls and applies writes to `events`. */
export const memoryClient = (
  initial: AmplitudeEvent[],
  categoryNames: string[],
  options: MemoryClientOptions = {},
): { client: AmplitudeClient; calls: string[]; events: Map<string, AmplitudeEvent> } => {
  const events = new Map(initial.map((e) => [e.event_type, { ...e }]));
  const categories = new Set(categoryNames);
  const calls: string[] = [];
  const fail = (status: number, what: string) => {
    throw new AmplitudeApiError(`${what} -> HTTP ${status}`, status, '');
  };
  const client: AmplitudeClient = {
    listEvents: async () => [...events.values()].map((e) => ({ ...e })),
    listCategories: async () => [...categories].map((name) => ({ name })),
    createCategory: async (name) => {
      calls.push(`createCategory ${name}`);
      const status = options.failCategories?.[name];
      if (status) {
        fail(status, `POST category ${name}`);
      }
      categories.add(name);
    },
    createEvent: async ({ name, description, category }) => {
      calls.push(`createEvent ${name}`);
      if (events.has(name)) {
        fail(409, `POST event ${name}`);
      }
      events.set(name, {
        // eslint-disable-next-line camelcase
        event_type: name,
        description,
        category: { name: category },
        tags: [],
        // eslint-disable-next-line camelcase
        display_name: null,
      });
    },
    updateEvent: async (name, changes) => {
      calls.push(`updateEvent ${name} ${Object.keys(changes).join(',')}`);
      const event = events.get(name);
      if (!event) {
        fail(404, `PUT event ${name}`);
        return;
      }
      if (options.failUpdates?.includes(name)) {
        fail(400, `PUT event ${name}`);
      }
      if (options.ignoreUpdates) {
        return;
      }
      Object.assign(event, {
        ...(changes.description !== undefined && { description: changes.description }),
        ...(changes.category !== undefined && { category: { name: changes.category } }),
        ...(changes.tags !== undefined && { tags: changes.tags }),
        // eslint-disable-next-line camelcase
        ...(changes.displayName !== undefined && { display_name: changes.displayName }),
      });
    },
  };
  return { client, calls, events };
};

/** A valid active entry; `name` also derives the key. */
export const makeEntry = (
  name: string,
  overrides: Partial<CollectedEntry> = {},
): CollectedEntry => ({
  file: 'packages/x/events.catalog.ts',
  exportName: 'xEvents',
  key: name.toUpperCase().replace(/\W/g, '_'),
  name,
  description: `Fired when ${name} happens in the UI.`,
  category: 'Forms',
  status: 'active',
  previousNames: [],
  tags: [],
  ...overrides,
});

/** An Amplitude event that already matches `makeEntry(name, overrides)` exactly. */
export const makeEvent = (name: string, fields: Partial<AmplitudeEvent> = {}): AmplitudeEvent => ({
  // eslint-disable-next-line camelcase
  event_type: name,
  description: `Fired when ${name} happens in the UI.`,
  category: { name: 'Forms' },
  // eslint-disable-next-line camelcase
  display_name: null,
  tags: ['odh-catalog'],
  deleted: false,
  ...fields,
});

/** A rename: `oldName` is deprecated in favour of `newName`, which lists it. */
export const makeRename = (oldName: string, newName: string): CollectedEntry[] => [
  makeEntry(oldName, {
    status: 'deprecated',
    deprecated: { since: '3.2', reason: 'Renamed', replacedBy: newName },
  }),
  makeEntry(newName, { previousNames: [oldName] }),
];
