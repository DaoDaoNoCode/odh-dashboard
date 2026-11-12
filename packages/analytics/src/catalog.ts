/**
 * Event catalog contracts. Packages describe the events they send in an
 * `events.catalog.ts` file; `scripts/amplitude-sync` validates those files and
 * syncs them to the Amplitude tracking plan.
 *
 * Type-only module: catalog files must import it with `import type` so they stay
 * loadable by Node's type stripping without resolving workspace packages.
 *
 * Lifecycle: an event name never changes once shipped and an entry is never deleted.
 * Retire an event with `status: 'deprecated'` or `'removed'`; rename it by adding a
 * new entry that lists the old name in `previousNames` and deprecating the old entry
 * with `deprecated.replacedBy`. See scripts/amplitude-sync/README.md.
 */
export type EventStatus = 'active' | 'deprecated' | 'removed';

export type EventDeprecation = {
  /** Release/version or ISO date when the event was deprecated. */
  since: string;
  /** Why the event is deprecated; shown in the Amplitude description. */
  reason: string;
  /** Name of the active catalog event that replaces this one. */
  replacedBy?: string;
};

type EventCatalogEntryBase = {
  /** Event name exactly as sent to Segment/Amplitude (`event_type`). Never changes once shipped. */
  name: string;
  /**
   * Human-readable description (min. 20 chars). Do not add a lifecycle prefix; the sync
   * adds `[DEPRECATED ...]` / `[REMOVED ...]` and the "Previously sent as" note itself.
   */
  description: string;
  /** Amplitude category name; created in Amplitude if it does not exist yet. */
  category: string;
  /** Names this event replaced (renames). Each must be a deprecated/removed catalog entry. */
  previousNames?: readonly string[];
  /** Amplitude display name. Only synced when set. */
  displayName?: string;
  /** Lowercase kebab-case tags, e.g. 'team-maas'. Use tags for ownership. */
  tags?: readonly string[];
  /** Property name to description. Documentation only; not synced yet. */
  properties?: Record<string, string>;
};

type ActiveEventCatalogEntry = EventCatalogEntryBase & {
  /** Defaults to 'active'. */
  status?: 'active';
  deprecated?: never;
  removedIn?: never;
};

type DeprecatedEventCatalogEntry = EventCatalogEntryBase & {
  status: 'deprecated';
  deprecated: EventDeprecation;
  removedIn?: never;
};

type RemovedEventCatalogEntry = EventCatalogEntryBase & {
  status: 'removed';
  /** Release/version or ISO date in which the app stopped sending the event. */
  removedIn: string;
  deprecated?: EventDeprecation;
};

export type EventCatalogEntry =
  | ActiveEventCatalogEntry
  | DeprecatedEventCatalogEntry
  | RemovedEventCatalogEntry;

export type EventCatalog = Record<string, EventCatalogEntry>;
