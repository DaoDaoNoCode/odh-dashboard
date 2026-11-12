# Amplitude event-description sync (spike)

Keeps the Amplitude tracking plan's event descriptions, categories, tags and display names in
sync with `events.catalog.ts` files in the repo, using the
[Amplitude Taxonomy API](https://amplitude.com/docs/apis/analytics/taxonomy).
Plain Node (>= 22.18, built-in type stripping), no npm dependencies.

## Catalog format

Any git-tracked file matching `*events.catalog.ts` is a catalog. It holds data only, and its
only import is the type import below. A regular `import { ... }` would make Node try to resolve
the workspace package at runtime.

```ts
import type { EventCatalog } from '@odh-dashboard/analytics/catalog';

export const maasEvents = {
  API_KEY_CREATED: {
    name: 'API Key Created', // exact event name sent to Segment; never changes once shipped
    description: 'User created a MaaS API key from the API keys page.',
    category: 'MaaS',
    tags: ['team-maas'], // optional, lowercase kebab-case; use tags for ownership
    displayName: 'API key created', // optional; only synced when set
    properties: { outcome: 'submit or cancel' }, // optional, not synced yet
  },
} as const satisfies EventCatalog;
```

Every exported object counts as a catalog. Identical duplicates of an entry are allowed.

| Field           | Required            | Notes                                                                                    |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `name`          | yes                 | Exact `event_type`. Amplitude is case- and whitespace-sensitive.                         |
| `description`   | yes                 | At least 20 characters, no `TODO`/`TBD`/`FIXME`, no lifecycle prefix (the sync adds it). |
| `category`      | yes                 | Created in Amplitude if missing.                                                         |
| `status`        | no                  | `'active'` (default), `'deprecated'` or `'removed'`.                                     |
| `deprecated`    | with `'deprecated'` | `{ since, reason, replacedBy? }`. Also allowed with `'removed'`.                         |
| `removedIn`     | with `'removed'`    | Release, version or ISO date. Only allowed with `'removed'`.                             |
| `previousNames` | no                  | Old names this event replaced (renames).                                                 |
| `tags`          | no                  | Lowercase kebab-case, e.g. `team-maas`.                                                  |
| `displayName`   | no                  | Non-empty, trimmed.                                                                      |
| `properties`    | no                  | Documentation only.                                                                      |

`owner` is not supported: Amplitude only accepts existing Amplitude users there. Use a
`team-*` tag instead.

## Event lifecycle

**Never rename or delete a shipped event name.** Amplitude keys all history by the exact name,
so a renamed entry would create a second, empty event and orphan the old data. Entries stay in
the catalog forever; their `status` records what happened.

### Deprecate (the app still sends it, but nobody should build on it)

```ts
export const modelsEvents = {
  OLD_FILTER_USED: {
    name: 'Filter Used',
    description: 'User applied a filter on the models table.',
    category: 'Models',
    status: 'deprecated',
    deprecated: {
      since: '3.2',
      reason: 'Superseded by the new filter toolbar',
      replacedBy: 'Filter Applied',
    },
  },
} as const satisfies EventCatalog;
```

Amplitude shows
`[DEPRECATED since 3.2: Superseded by the new filter toolbar. Use "Filter Applied" instead] User applied ...`
and the event gets the `deprecated` tag. `replacedBy` is optional and must name an active
catalog entry.

### Remove (the app no longer sends it)

```ts
export const modelsEvents = {
  LEGACY_EXPORT: {
    name: 'Legacy Export Clicked',
    description: 'User clicked the legacy export button.',
    category: 'Models',
    status: 'removed',
    removedIn: '3.4',
    // deprecated: { ... } may stay from the deprecation step
  },
} as const satisfies EventCatalog;
```

Amplitude shows `[REMOVED in 3.4] User clicked ...` and the event gets the `removed` tag.

### Rename

Keep the old entry as a tombstone and add the new one:

```ts
export const modelsEvents = {
  FILTER_USED: {
    name: 'Filter Used',
    description: 'User applied a filter on the models table.',
    category: 'Models',
    status: 'deprecated', // 'removed' + removedIn once the app stops sending it
    deprecated: { since: '3.2', reason: 'Renamed', replacedBy: 'Filter Applied' },
  },
  FILTER_APPLIED: {
    name: 'Filter Applied',
    description: 'User applied a filter on the models table.',
    category: 'Models',
    previousNames: ['Filter Used'],
  },
} as const satisfies EventCatalog;
```

Every `previousNames` item must be a deprecated or removed entry whose
`deprecated.replacedBy` is the new name, and a name can only be listed by one entry. The new
event's description gets
`Previously sent as: "Filter Used". Merge them in Amplitude Data to keep one history.` and the
`renamed` tag.

### What the sync writes

- Description: the lifecycle prefix, the description, and the rename suffix. The result must
  be at most 4096 characters (Amplitude's limit).
- Tags: the entry's `tags` plus the managed tags `odh-catalog` (always), `deprecated` /
  `removed` (by status) and `renamed` (with `previousNames`). The list replaces the tags in
  Amplitude, so tags added by hand in Amplitude are removed. Catalog entries cannot list the
  managed tags themselves.
- Display name: only when the entry sets `displayName`. A display name set in Amplitude is
  never cleared.
- Deprecated or removed entries that do not exist in Amplitude are not created ("never
  shipped").

### What needs an Amplitude admin

The Taxonomy API cannot do these; the sync report lists what is pending:

- **Merge transformations** for renames ("History to stitch"): Amplitude Data →
  Transformations → Merge events, merging the old name into the new one so Funnels and
  Journeys see one history. Until then, use a custom event that ORs both names.
- **Blocking** removed events that still arrive (for example from old clients).
- **Marking events official** (verified) in the tracking plan.

## Validation

`--validate` fails on:

- missing, non-string, or untrimmed `name`/`description`/`category`; short or placeholder
  descriptions; unknown fields (including `owner`) and wrong field types;
- the same name defined twice with different values;
- an invalid `status`, `deprecated` without `since`/`reason`, `deprecated` on an active entry,
  a missing `removedIn` on a removed entry, or `removedIn` on any other status;
- a `replacedBy` that is not an active catalog entry, or the entry itself;
- `previousNames` rules above (tombstone missing, wrong status or `replacedBy`, self, listed
  twice);
- two names that only differ by case or whitespace (they would become separate Amplitude
  events);
- an effective description over 4096 characters;
- tags that are not lowercase kebab-case, duplicated or managed; an empty or untrimmed
  `displayName`.

With `--base <git-ref>` it also loads every catalog as it was at the merge base of `<git-ref>`
and `HEAD` (via `git ls-tree` / `git cat-file` into a temp directory) and fails if a name that
existed there is gone now. Reactivating a deprecated or removed name only prints a warning. A
missing ref or a base without catalogs skips the check with a note.

## Running locally

```bash
# Validate catalogs (no network, no secrets). New catalog files must be `git add`-ed first.
node scripts/amplitude-sync/sync.ts --validate
node scripts/amplitude-sync/sync.ts --validate --base origin/main
node scripts/amplitude-sync/sync.ts --validate path/to/some.events.catalog.ts

# Read Amplitude and print the plan without writing anything
source ~/.config/amplitude-prod.env   # exports AMPLITUDE_API_KEY / AMPLITUDE_SECRET_KEY [/ AMPLITUDE_HOST]
node scripts/amplitude-sync/sync.ts --sync --dry-run

# Apply the plan
node scripts/amplitude-sync/sync.ts --sync
```

`AMPLITUDE_HOST` defaults to `https://amplitude.com`. Node prints a one-time
`MODULE_TYPELESS_PACKAGE_JSON` notice because the `.ts` files sit under `package.json` files
without `"type"`. ES module detection still works. Add
`--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` to hide the notice.

Tests and type-check:

```bash
pnpm run test:amplitude-sync      # node --test scripts/amplitude-sync/__tests__/*.test.ts
pnpm exec tsc -p scripts/amplitude-sync
pnpm exec eslint scripts/amplitude-sync
```

## Safety rules

- Never deletes anything: the client has no DELETE method, and the sync never sets
  `is_active`.
- Only writes events that appear in a catalog. Other Amplitude events are only counted and
  listed in the report ("in Amplitude but in no catalog").
- Creates (POST) missing events and categories, then sets tags and display name with a PUT.
  Updates (PUT) only the fields that differ. If a create returns 409 "already exists", it
  falls back to PUT.
- Never creates an event whose name differs from an existing Amplitude event only by case or
  whitespace; that is reported as a conflict and fails the run (dry runs included).
- If a category cannot be created, every create or update that needs it is skipped and
  reported as failed (Amplitude silently ignores writes that reference a missing category).
- After writing, it reads the tracking plan again and checks that every created or updated
  event has the expected description, category, tags and (if managed) display name.
  Amplitude answers some invalid writes with success but changes nothing; those show up as
  verification failures.
- Writes run one at a time. On 429 and 5xx responses the script retries with exponential
  backoff, up to 5 attempts. Any other failure is reported with the response body and
  makes the run exit non-zero. Credentials are never printed.

## Report

The sync prints a text report and writes a markdown version to `GITHUB_STEP_SUMMARY`: counts
by lifecycle status, categories, creates, updates, unchanged events, skipped never-shipped
entries, conflicts, failed writes, verification failures, history to stitch, and events in
Amplitude that no catalog describes.

## CI

`.github/workflows/amplitude-taxonomy-sync.yml`:

- On pull requests, the `validate` job checks out the full history, makes sure
  `origin/<base branch>` exists, runs the tests and
  `--validate --base origin/<base branch>`. It uses no secrets.
- On pushes to `main` and on manual runs, the `sync` job uses the `amplitude-prod`
  environment, which provides the secrets `AMPLITUDE_API_KEY` and `AMPLITUDE_SECRET_KEY`
  and the optional variable `AMPLITUDE_HOST`. A manual run with `dry_run` only prints the
  plan. Restrict the environment's deployment branches to `main`.
