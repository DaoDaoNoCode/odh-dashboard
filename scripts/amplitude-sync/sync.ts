// Validates `*events.catalog.ts` files and syncs event descriptions, categories, tags and
// display names to the Amplitude tracking plan. Zero dependencies; run with
// Node >= 22.18 (type stripping):
//
//   node scripts/amplitude-sync/sync.ts --validate [--base <git-ref>] [catalog files...]
//   node scripts/amplitude-sync/sync.ts --sync [--dry-run]
//
// --sync needs AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY (AMPLITUDE_HOST optional).
// The sync never deletes anything and only writes events that are in a catalog.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { createAmplitudeClient, DEFAULT_HOST, type AmplitudeClient } from './amplitude.ts';
import { checkAgainstBase } from './base.ts';
import {
  collectEntries,
  dedupeEntries,
  discoverCatalogFiles,
  loadCatalogModules,
  validateEntries,
  type CollectedEntry,
} from './catalog.ts';
import { executePlan, type ExecutionResult } from './execute.ts';
import { computePlan, type SyncPlan } from './plan.ts';
import {
  renderCatalogMarkdown,
  renderCatalogText,
  renderSyncMarkdown,
  renderSyncText,
} from './report.ts';
import { verifyWrites, type VerificationFailure } from './verify.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const USAGE = `Usage:
  node scripts/amplitude-sync/sync.ts --validate [--base <git-ref>] [catalog files...]
  node scripts/amplitude-sync/sync.ts --sync [--dry-run]

--base <git-ref>  also fail when an event name that exists in the catalogs at the merge base
                  of <git-ref> and HEAD is missing now (skipped if the ref does not exist)

Environment for --sync:
  AMPLITUDE_API_KEY      (required)
  AMPLITUDE_SECRET_KEY   (required)
  AMPLITUDE_HOST         (optional, default ${DEFAULT_HOST}; use https://analytics.eu.amplitude.com for EU)`;

type Options = {
  mode: 'validate' | 'sync';
  dryRun: boolean;
  files: string[];
  base?: string;
};

const parseArgs = (argv: string[]): Options | string => {
  const flags = new Set<string>();
  const files: string[] = [];
  let base: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base' || arg.startsWith('--base=')) {
      const value = arg === '--base' ? argv[(i += 1)] : arg.slice('--base='.length);
      if (!value || value.startsWith('-')) {
        return '--base needs a git ref, e.g. --base origin/main';
      }
      base = value;
      flags.add('--base');
    } else if (arg.startsWith('-')) {
      flags.add(arg);
    } else {
      files.push(arg);
    }
  }
  const known = new Set(['--validate', '--sync', '--dry-run', '--base', '--help', '-h']);
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
  if (base !== undefined && flags.has('--sync')) {
    return '--base can only be used with --validate.';
  }
  if (base !== undefined && files.length) {
    return '--base compares all tracked catalogs; it cannot be combined with file arguments.';
  }
  return {
    mode: flags.has('--sync') ? 'sync' : 'validate',
    dryRun: flags.has('--dry-run'),
    files,
    ...(base !== undefined && { base }),
  };
};

const writeStepSummary = (markdown: string) => {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, `${markdown}\n`);
  }
};

/** Loads and validates catalogs; returns deduped entries or null when invalid. */
const loadAndValidate = async (
  files: string[],
  base?: string,
): Promise<CollectedEntry[] | null> => {
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
  const warnings: string[] = [];
  if (base !== undefined) {
    const baseCheck = await checkAgainstBase(REPO_ROOT, base, collected.entries);
    baseCheck.notes.forEach((note) => console.log(note));
    errors.push(...baseCheck.errors);
    warnings.push(...baseCheck.warnings);
  }
  console.log(renderCatalogText(collected.entries, errors, warnings));
  writeStepSummary(renderCatalogMarkdown(collected.entries, errors, warnings));
  return errors.length ? null : dedupeEntries(collected.entries);
};

/** Re-reads the tracking plan and checks that every write really landed. */
const verify = async (
  client: AmplitudeClient,
  plan: SyncPlan,
  result: ExecutionResult,
): Promise<VerificationFailure[]> => {
  if (!result.created.length && !result.updated.length) {
    return [];
  }
  console.log('\nVerifying the writes');
  try {
    return verifyWrites(plan, result, await client.listEvents());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return [{ name: '(all)', message: `could not re-read the tracking plan: ${message}` }];
  }
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
    return plan.conflicts.length ? 1 : 0;
  }

  const result = await executePlan(plan, client, (message) => console.log(`  ${message}`));
  const verification = await verify(client, plan, result);
  console.log(`\n${renderSyncText({ plan, result, verification })}`);
  writeStepSummary(renderSyncMarkdown({ plan, result, verification }));
  return result.failures.length || plan.conflicts.length || verification.length ? 1 : 0;
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
    return (await loadAndValidate(options.files, options.base)) ? 0 : 1;
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
