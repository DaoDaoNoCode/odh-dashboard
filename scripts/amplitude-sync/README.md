# Amplitude event-description sync (spike)

Keeps the Amplitude tracking plan's event descriptions and categories in sync with
`events.catalog.ts` files in the repo, using the
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
    name: 'API Key Created', // exact event name sent to Segment
    description: 'User created a MaaS API key from the API keys page.',
    category: 'MaaS',
    properties: { outcome: 'submit or cancel' }, // optional, not synced yet
  },
} as const satisfies EventCatalog;
```

Every exported object counts as a catalog. Validation fails when `name`, `description` or
`category` is empty or has leading/trailing whitespace, when a description is shorter than
20 characters or contains `TODO`/`TBD`/`FIXME`, or when the same event name is defined twice
with a different description or category. Identical duplicates are allowed.

## Running locally

```bash
# Validate catalogs (no network, no secrets). New catalog files must be `git add`-ed first.
node scripts/amplitude-sync/sync.ts --validate
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

- Never deletes anything: the client has no DELETE method.
- Only writes events that appear in a catalog. Other Amplitude events are only counted and
  listed in the report ("in Amplitude but in no catalog").
- Creates (POST) missing events and categories, and updates (PUT) only the fields that
  differ. If a create returns 409 "already exists", it falls back to PUT.
- Writes run one at a time. On 429 and 5xx responses the script retries with exponential
  backoff, up to 5 attempts. Any other failure is reported with the response body and
  makes the run exit non-zero. Credentials are never printed.

## CI

`.github/workflows/amplitude-taxonomy-sync.yml`:

- On pull requests, the `validate` job runs the tests and `--validate`. It uses no secrets.
- On pushes to `main` and on manual runs, the `sync` job uses the `amplitude-prod`
  environment, which provides the secrets `AMPLITUDE_API_KEY` and `AMPLITUDE_SECRET_KEY`
  and the optional variable `AMPLITUDE_HOST`. A manual run with `dry_run` only prints the
  plan. Restrict the environment's deployment branches to `main`.
