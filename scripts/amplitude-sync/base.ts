// Name stability: compares the catalogs with a git base so that a shipped event name is
// never dropped. Reads the base with git plumbing; never touches the working tree.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CATALOG_SUFFIX,
  collectEntries,
  describeLocation,
  loadCatalogModules,
  type CollectedEntry,
} from './catalog.ts';

export type BaseCheckResult = {
  errors: string[];
  /** Printed, never fail the run. */
  warnings: string[];
  /** Why the check was skipped or what it compared with. */
  notes: string[];
};

const git = (repoRoot: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const tryGit = (repoRoot: string, args: string[]): string | null => {
  try {
    return git(repoRoot, args).trim();
  } catch {
    return null;
  }
};

/** Pure comparison of the base catalog with the current one. */
export const compareWithBase = (
  baseEntries: CollectedEntry[],
  currentEntries: CollectedEntry[],
  baseLabel: string,
): Pick<BaseCheckResult, 'errors' | 'warnings'> => {
  const current = new Map<string, CollectedEntry>();
  for (const entry of currentEntries) {
    if (!current.has(entry.name)) {
      current.set(entry.name, entry);
    }
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const base of baseEntries) {
    if (!base.name || seen.has(base.name)) {
      continue;
    }
    seen.add(base.name);
    const now = current.get(base.name);
    if (!now) {
      errors.push(
        `Event "${base.name}" was removed from the catalog (it was in ${describeLocation(base)} ` +
          `at ${baseLabel}). Keep it and set status: 'removed' (or 'deprecated' with replacedBy ` +
          'for a rename)',
      );
    } else if (base.status !== 'active' && now.status === 'active') {
      warnings.push(
        `Event "${base.name}" was '${base.status}' at ${baseLabel} and is active again. ` +
          'Make sure the app sends it again.',
      );
    }
  }
  return { errors, warnings };
};

/** Loads every catalog as it exists at `commit` by importing temp copies of the files. */
export const loadEntriesAtCommit = async (
  repoRoot: string,
  commit: string,
): Promise<{ files: string[]; entries: CollectedEntry[]; loadErrors: string[] }> => {
  const files = git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', commit])
    .split('\0')
    .filter((file) => file.endsWith(CATALOG_SUFFIX))
    .toSorted();
  if (!files.length) {
    return { files, entries: [], loadErrors: [] };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amplitude-sync-base-'));
  try {
    for (const file of files) {
      const target = path.join(tmp, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, git(repoRoot, ['cat-file', 'blob', `${commit}:${file}`]));
    }
    const loaded = await loadCatalogModules(tmp, files);
    // Base entries only provide names and statuses; validation errors there do not matter.
    return { files, entries: collectEntries(loaded.modules).entries, loadErrors: loaded.errors };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

/**
 * Fails when an event name that exists at the merge base of `ref` and HEAD is gone now.
 * A missing ref or a base without catalogs skips the check with a note.
 */
export const checkAgainstBase = async (
  repoRoot: string,
  ref: string,
  currentEntries: CollectedEntry[],
): Promise<BaseCheckResult> => {
  const result: BaseCheckResult = { errors: [], warnings: [], notes: [] };
  const refCommit = ref.startsWith('-')
    ? null
    : tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!refCommit) {
    result.notes.push(`Base "${ref}" not found; skipped the name-stability check.`);
    return result;
  }
  // Compare with the fork point so a stale branch is not blamed for events added on the base
  // since. In a pull_request checkout (merge commit) this is the base branch tip.
  const mergeBase = tryGit(repoRoot, ['merge-base', refCommit, 'HEAD']);
  const commit = mergeBase ?? refCommit;
  const label = `${ref} (${commit.slice(0, 12)})`;
  if (!mergeBase) {
    result.notes.push(`No merge base between "${ref}" and HEAD; comparing with "${ref}" itself.`);
  }

  const { files, entries, loadErrors } = await loadEntriesAtCommit(repoRoot, commit);
  if (!files.length) {
    result.notes.push(`No catalogs at ${label}; skipped the name-stability check.`);
    return result;
  }
  result.notes.push(
    `Name-stability check against ${label}: ${entries.length} event(s) in ${files.length} file(s).`,
  );
  result.warnings.push(...loadErrors.map((e) => `Could not load a base catalog: ${e}`));
  const compared = compareWithBase(entries, currentEntries, label);
  result.errors.push(...compared.errors);
  result.warnings.push(...compared.warnings);
  return result;
};
