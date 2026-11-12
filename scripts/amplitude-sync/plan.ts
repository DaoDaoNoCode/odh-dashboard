// Pure diff between catalog entries and the Amplitude tracking plan.
import type { CollectedEntry } from './catalog.ts';

/** Subset of an item from `GET /api/2/taxonomy/event`. */
export type AmplitudeEvent = {
  // eslint-disable-next-line camelcase
  event_type: string;
  description?: string | null;
  category?: { name?: string | null } | string | null;
  deleted?: boolean;
};

/** Item from `GET /api/2/taxonomy/category`. */
export type AmplitudeCategory = {
  id?: number | string;
  name: string;
};

export type EventChanges = {
  description?: string;
  category?: string;
};

export type PlannedUpdate = {
  entry: CollectedEntry;
  changes: EventChanges;
  current: { description: string; category: string };
};

export type UntrackedSummary = {
  /** Non-deleted Amplitude events that no catalog describes. */
  total: number;
  /** Amplitude built-ins (`[Amplitude] ...`, `session_...`), counted but not listed. */
  builtInCount: number;
  /** Everything else, sorted. */
  listed: string[];
};

export type SyncPlan = {
  categoriesToCreate: string[];
  create: CollectedEntry[];
  update: PlannedUpdate[];
  unchanged: CollectedEntry[];
  untracked: UntrackedSummary;
};

export const categoryName = (category: AmplitudeEvent['category']): string => {
  if (typeof category === 'string') {
    return category;
  }
  return category?.name ?? '';
};

export const isBuiltInEvent = (name: string): boolean =>
  name.startsWith('[Amplitude]') || name.startsWith('session_');

export const summarizeUntracked = (
  events: AmplitudeEvent[],
  catalogNames: ReadonlySet<string>,
): UntrackedSummary => {
  const untracked = events.filter((e) => !e.deleted && !catalogNames.has(e.event_type));
  const listed = untracked
    .map((e) => e.event_type)
    .filter((name) => !isBuiltInEvent(name))
    .toSorted((a, b) => a.localeCompare(b));
  return { total: untracked.length, builtInCount: untracked.length - listed.length, listed };
};

/** Entries must already be validated and deduped. */
export const computePlan = (
  entries: CollectedEntry[],
  events: AmplitudeEvent[],
  categories: AmplitudeCategory[],
): SyncPlan => {
  const live = new Map(events.filter((e) => !e.deleted).map((e) => [e.event_type, e]));
  const existingCategories = new Set(categories.map((c) => c.name));

  const create: CollectedEntry[] = [];
  const update: PlannedUpdate[] = [];
  const unchanged: CollectedEntry[] = [];

  for (const entry of entries) {
    const event = live.get(entry.name);
    if (!event) {
      create.push(entry);
      continue;
    }
    const current = {
      description: event.description ?? '',
      category: categoryName(event.category),
    };
    const changes: EventChanges = {};
    if (current.description !== entry.description) {
      changes.description = entry.description;
    }
    if (current.category !== entry.category) {
      changes.category = entry.category;
    }
    if (Object.keys(changes).length > 0) {
      update.push({ entry, changes, current });
    } else {
      unchanged.push(entry);
    }
  }

  const neededCategories = new Set([
    ...create.map((e) => e.category),
    ...update.flatMap((u) => (u.changes.category ? [u.changes.category] : [])),
  ]);
  const categoriesToCreate = [...neededCategories]
    .filter((c) => !existingCategories.has(c))
    .toSorted();

  return {
    categoriesToCreate,
    create,
    update,
    unchanged,
    untracked: summarizeUntracked(events, new Set(entries.map((e) => e.name))),
  };
};
