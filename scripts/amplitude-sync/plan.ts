// Pure diff between catalog entries and the Amplitude tracking plan.
import type { CollectedEntry } from './catalog.ts';
import { desiredState, normalizeName, type DesiredState } from './lifecycle.ts';

/** Subset of an item from `GET /api/2/taxonomy/event`. */
export type AmplitudeEvent = {
  // eslint-disable-next-line camelcase
  event_type: string;
  description?: string | null;
  category?: { name?: string | null } | string | null;
  // eslint-disable-next-line camelcase
  display_name?: string | null;
  tags?: string[] | null;
  deleted?: boolean;
};

/** Item from `GET /api/2/taxonomy/category`. */
export type AmplitudeCategory = {
  id?: number | string;
  name: string;
};

/** Fields to send in a PUT. Tags replace Amplitude's whole tag list. */
export type EventChanges = {
  description?: string;
  category?: string;
  tags?: string[];
  displayName?: string;
};

export type CurrentState = {
  description: string;
  category: string;
  tags: string[];
  displayName: string | null;
};

export type PlannedUpdate = {
  entry: CollectedEntry;
  changes: EventChanges;
  current: CurrentState;
};

/** A missing entry that was not created because Amplitude has a case/space variant. */
export type NameConflict = {
  entry: CollectedEntry;
  /** Existing Amplitude event names with the same normalized name. */
  existing: string[];
};

/** An old event name that still has data in Amplitude under a different event. */
export type HistoryToStitch = {
  oldName: string;
  newName: string;
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
  /** Deprecated/removed entries that are not in Amplitude: never shipped, never created. */
  skipped: CollectedEntry[];
  conflicts: NameConflict[];
  history: HistoryToStitch[];
  lifecycle: { active: number; deprecated: number; removed: number };
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

export const currentState = (event: AmplitudeEvent): CurrentState => ({
  description: event.description ?? '',
  category: categoryName(event.category),
  tags: (event.tags ?? []).toSorted(),
  displayName: event.display_name ?? null,
});

const sameSet = (a: string[], b: string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
};

/** Fields of `desired` that differ from what Amplitude has. */
export const diffEvent = (desired: DesiredState, current: CurrentState): EventChanges => {
  const changes: EventChanges = {};
  if (current.description !== desired.description) {
    changes.description = desired.description;
  }
  if (current.category !== desired.category) {
    changes.category = desired.category;
  }
  if (!sameSet(current.tags, desired.tags)) {
    changes.tags = desired.tags;
  }
  if (desired.displayName !== undefined && current.displayName !== desired.displayName) {
    changes.displayName = desired.displayName;
  }
  return changes;
};

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
  const liveEvents = events.filter((e) => !e.deleted);
  const live = new Map(liveEvents.map((e) => [e.event_type, e]));
  const liveByNormalized = new Map<string, string[]>();
  for (const { event_type: name } of liveEvents) {
    const key = normalizeName(name);
    liveByNormalized.set(key, [...(liveByNormalized.get(key) ?? []), name]);
  }
  const existingCategories = new Set(categories.map((c) => c.name));

  const plan: SyncPlan = {
    categoriesToCreate: [],
    create: [],
    update: [],
    unchanged: [],
    skipped: [],
    conflicts: [],
    history: [],
    lifecycle: { active: 0, deprecated: 0, removed: 0 },
    untracked: summarizeUntracked(events, new Set(entries.map((e) => e.name))),
  };

  for (const entry of entries) {
    if (entry.status === 'deprecated' || entry.status === 'removed') {
      plan.lifecycle[entry.status] += 1;
    } else {
      plan.lifecycle.active += 1;
    }
    for (const oldName of entry.previousNames) {
      if (live.has(oldName)) {
        plan.history.push({ oldName, newName: entry.name });
      }
    }

    const event = live.get(entry.name);
    if (!event) {
      if (entry.status !== 'active') {
        plan.skipped.push(entry);
        continue;
      }
      const variants = liveByNormalized.get(normalizeName(entry.name));
      if (variants) {
        plan.conflicts.push({ entry, existing: variants });
      } else {
        plan.create.push(entry);
      }
      continue;
    }
    const current = currentState(event);
    const changes = diffEvent(desiredState(entry), current);
    if (Object.keys(changes).length > 0) {
      plan.update.push({ entry, changes, current });
    } else {
      plan.unchanged.push(entry);
    }
  }

  const neededCategories = new Set([
    ...plan.create.map((e) => e.category),
    ...plan.update.flatMap((u) => (u.changes.category ? [u.changes.category] : [])),
  ]);
  plan.categoriesToCreate = [...neededCategories]
    .filter((c) => !existingCategories.has(c))
    .toSorted();
  return plan;
};
