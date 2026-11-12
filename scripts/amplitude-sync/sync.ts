// Validates `*events.catalog.ts` files and syncs event descriptions/categories to the
// Amplitude tracking plan. Zero dependencies; run with Node >= 22.18 (type stripping):
//
//   node scripts/amplitude-sync/sync.ts --validate [catalog files...]
//   node scripts/amplitude-sync/sync.ts --sync [--dry-run]
//
// --sync needs AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY (AMPLITUDE_HOST optional).
// The sync never deletes anything and only writes events that are in a catalog.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { createAmplitudeClient, DEFAULT_HOST } from './amplitude.ts';
import {
  collectEntries,
  dedupeEntries,
  discoverCatalogFiles,
  loadCatalogModules,
  validateEntries,
  type CollectedEntry,
} from './catalog.ts';
import { executePlan } from './execute.ts';
import { computePlan } from './plan.ts';
import {
  renderCatalogMarkdown,
  renderCatalogText,
  renderSyncMarkdown,
  renderSyncText,
} from './report.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const USAGE = `Usage:
  node scripts/amplitude-sync/sync.ts --validate [catalog files...]
  node scripts/amplitude-sync/sync.ts --sync [--dry-run]

Environment for --sync:
  AMPLITUDE_API_KEY      (required)
  AMPLITUDE_SECRET_KEY   (required)
  AMPLITUDE_HOST         (optional, default ${DEFAULT_HOST}; use https://analytics.eu.amplitude.com for EU)`;

type Options = { mode: 'validate' | 'sync'; dryRun: boolean; files: string[] };

const parseArgs = (argv: string[]): Options | string => {
  const flags = new Set(argv.filter((a) => a.startsWith('-')));
  const files = argv.filter((a) => !a.startsWith('-'));
  const known = new Set(['--validate', '--sync', '--dry-run', '--help', '-h']);
  const unknown = [...flags].filter((f) => !known.has(f));
  if (unknown.length) {
    return `Unknown option(s): ${unknown.join(', ')}`;
  }
  if (flags.has('--help') || flags.has('-h')) {
    return '';
  }
  if (flags.has('--validate') === flags.has('--sync')) {
    return 'Pass exactly one of --validate or --sync.';
  }
  if (flags.has('--dry-run') && !flags.has('--sync')) {
    return '--dry-run can only be used with --sync.';
  }
  if (files.length && flags.has('--sync')) {
    return '--sync always uses the tracked catalogs; file arguments are only allowed with --validate.';
  }
  return { mode: flags.has('--sync') ? 'sync' : 'validate', dryRun: flags.has('--dry-run'), files };
};

const writeStepSummary = (markdown: string) => {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, `${markdown}\n`);
  }
};

/** Loads and validates catalogs; returns deduped entries or null when invalid. */
const loadAndValidate = async (files: string[]): Promise<CollectedEntry[] | null> => {
  const catalogFiles = files.length
    ? files.map((f) => path.relative(REPO_ROOT, path.resolve(f)))
    : discoverCatalogFiles(REPO_ROOT);
  console.log(`Catalog files (${catalogFiles.length}):`);
  catalogFiles.forEach((f) => console.log(`  - ${f}`));
  console.log('');

  const loaded = await loadCatalogModules(REPO_ROOT, catalogFiles);
  const collected = collectEntries(loaded.modules);
  const errors = [
    // An empty discovery almost certainly means the lookup broke; never sync "nothing".
    ...(catalogFiles.length
      ? []
      : ['No *events.catalog.ts files found (they must be tracked by git).']),
    ...loaded.errors,
    ...collected.errors,
    ...validateEntries(collected.entries),
  ];
  console.log(renderCatalogText(collected.entries, errors));
  writeStepSummary(renderCatalogMarkdown(collected.entries, errors));
  return errors.length ? null : dedupeEntries(collected.entries);
};

const sync = async (dryRun: boolean): Promise<number> => {
  const apiKey = process.env.AMPLITUDE_API_KEY ?? '';
  const secretKey = process.env.AMPLITUDE_SECRET_KEY ?? '';
  const missing = [
    ...(apiKey ? [] : ['AMPLITUDE_API_KEY']),
    ...(secretKey ? [] : ['AMPLITUDE_SECRET_KEY']),
  ];
  if (missing.length) {
    console.error(`Error: --sync requires environment variable(s): ${missing.join(', ')}`);
    return 1;
  }

  const entries = await loadAndValidate([]);
  if (!entries) {
    return 1;
  }

  const host = process.env.AMPLITUDE_HOST || DEFAULT_HOST;
  console.log(`\nReading the tracking plan from ${host}`);
  const client = createAmplitudeClient({
    host,
    apiKey,
    secretKey,
    log: (message) => console.log(`  ${message}`),
  });
  const events = await client.listEvents();
  const categories = await client.listCategories();
  console.log(`  ${events.length} event(s), ${categories.length} categor(ies)\n`);

  const plan = computePlan(entries, events, categories);
  if (dryRun) {
    console.log(renderSyncText({ plan, result: null }));
    writeStepSummary(renderSyncMarkdown({ plan, result: null }));
    return 0;
  }

  const result = await executePlan(plan, client, (message) => console.log(`  ${message}`));
  console.log(`\n${renderSyncText({ plan, result })}`);
  writeStepSummary(renderSyncMarkdown({ plan, result }));
  return result.failures.length ? 1 : 0;
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  if (typeof options === 'string') {
    if (options) {
      console.error(`Error: ${options}\n`);
    }
    console.log(USAGE);
    return options ? 2 : 0;
  }
  if (options.mode === 'validate') {
    return (await loadAndValidate(options.files)) ? 0 : 1;
  }
  return sync(options.dryRun);
};

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
