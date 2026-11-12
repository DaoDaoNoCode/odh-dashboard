// Event lifecycle: the effective description/tags/display name the sync writes for an
// entry. Pure functions, no network.
import type { CollectedEntry } from './catalog.ts';

export const EVENT_STATUSES = ['active', 'deprecated', 'removed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Amplitude rejects longer descriptions with HTTP 400. */
export const DESCRIPTION_MAX_LENGTH = 4096;
export const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Tag added to every event the sync manages. */
export const CATALOG_TAG = 'odh-catalog';
/** Tags the sync sets itself; catalog entries may not list them. */
export const MANAGED_TAGS: readonly string[] = [CATALOG_TAG, 'deprecated', 'removed', 'renamed'];

/** The state the sync wants Amplitude to have for an event. */
export type DesiredState = {
  description: string;
  category: string;
  /** Sorted, unique. Sent as a comma-joined list, which replaces Amplitude's tags. */
  tags: string[];
  /** Only managed when the entry sets it; undefined leaves Amplitude's value alone. */
  displayName?: string;
};

export type LifecycleEntry = Pick<
  CollectedEntry,
  'description' | 'status' | 'deprecated' | 'removedIn' | 'previousNames'
>;

/**
 * Amplitude treats names that differ only by case or whitespace as different events.
 * Two names with the same normalized form must never both exist.
 */
export const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, ' ').trim();

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

/** Description plus the lifecycle prefix and the rename suffix. */
export const effectiveDescription = (entry: LifecycleEntry): string => {
  let prefix = '';
  if (entry.status === 'deprecated' && entry.deprecated) {
    const { since, reason, replacedBy } = entry.deprecated;
    const replacement = replacedBy ? `. Use "${replacedBy}" instead` : '';
    prefix = `[DEPRECATED since ${since}: ${reason}${replacement}] `;
  } else if (entry.status === 'removed') {
    const replacedBy = entry.deprecated?.replacedBy;
    const replacement = replacedBy ? `. Replaced by "${replacedBy}"` : '';
    prefix = `[REMOVED in ${entry.removedIn ?? ''}${replacement}] `;
  }
  const suffix = entry.previousNames.length
    ? `\n\nPreviously sent as: ${quoted(entry.previousNames)}. ` +
      'Merge them in Amplitude Data to keep one history.'
    : '';
  return `${prefix}${entry.description}${suffix}`;
};

/** Sorted union of the entry's tags and the managed tags for its lifecycle state. */
export const effectiveTags = (
  entry: Pick<CollectedEntry, 'status' | 'previousNames' | 'tags'>,
): string[] => {
  const tags = new Set([...entry.tags, CATALOG_TAG]);
  if (entry.status === 'deprecated' || entry.status === 'removed') {
    tags.add(entry.status);
  }
  if (entry.previousNames.length) {
    tags.add('renamed');
  }
  return [...tags].toSorted();
};

export const desiredState = (entry: CollectedEntry): DesiredState => ({
  description: effectiveDescription(entry),
  category: entry.category,
  tags: effectiveTags(entry),
  ...(entry.displayName !== undefined && { displayName: entry.displayName }),
});
