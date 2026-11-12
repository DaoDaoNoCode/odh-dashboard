/**
 * Event catalog contracts. Packages describe the events they send in an
 * `events.catalog.ts` file; `scripts/amplitude-sync` validates those files and
 * syncs the descriptions to the Amplitude tracking plan.
 *
 * Type-only module: catalog files must import it with `import type` so they stay
 * loadable by Node's type stripping without resolving workspace packages.
 */
export type EventCatalogEntry = {
  /** Event name exactly as sent to Segment/Amplitude (`event_type`). */
  name: string;
  /** Human-readable description shown in the Amplitude tracking plan (min. 20 chars). */
  description: string;
  /** Amplitude category name; created in Amplitude if it does not exist yet. */
  category: string;
  /** Property name to description. Documentation only; not synced yet. */
  properties?: Record<string, string>;
};

export type EventCatalog = Record<string, EventCatalogEntry>;
