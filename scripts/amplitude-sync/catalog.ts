// Catalog discovery, loading, collection and validation. No network access.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CATALOG_PATHSPEC = '*events.catalog.ts';
export const MIN_DESCRIPTION_LENGTH = 20;
const PLACEHOLDER_PATTERN = /\b(TODO|TBD|FIXME)\b/i;
const REQUIRED_FIELDS = ['name', 'description', 'category'] as const;

export type CollectedEntry = {
  /** Repo-relative path of the catalog file. */
  file: string;
  exportName: string;
  key: string;
  name: string;
  description: string;
  category: string;
};

export type LoadedModule = {
  file: string;
  exports: Record<string, unknown>;
};

export type CollectResult = {
  entries: CollectedEntry[];
  errors: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const describeLocation = (
  entry: Pick<CollectedEntry, 'file' | 'exportName' | 'key'>,
): string => `${entry.file} (${entry.exportName}.${entry.key})`;

/** Lists tracked catalog files, repo-relative and sorted. */
export const discoverCatalogFiles = (repoRoot: string): string[] =>
  execFileSync('git', ['ls-files', '-z', '--', CATALOG_PATHSPEC], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .toSorted();

/** Imports each catalog file. Import failures are reported as errors, not thrown. */
export const loadCatalogModules = async (
  repoRoot: string,
  files: string[],
): Promise<{ modules: LoadedModule[]; errors: string[] }> => {
  const modules: LoadedModule[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const url = pathToFileURL(path.resolve(repoRoot, file)).href;
      // eslint-disable-next-line no-await-in-loop
      const exports: Record<string, unknown> = await import(url);
      modules.push({ file, exports });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(
        `${file}: failed to load (${message}). Catalog files may only contain data and an ` +
          "`import type { EventCatalog } from '@odh-dashboard/analytics/catalog'`.",
      );
    }
  }
  return { modules, errors };
};

/** Collects the entries of every exported object in every loaded catalog module. */
export const collectEntries = (modules: LoadedModule[]): CollectResult => {
  const entries: CollectedEntry[] = [];
  const errors: string[] = [];
  for (const mod of modules) {
    let found = 0;
    for (const [exportName, value] of Object.entries(mod.exports)) {
      if (!isRecord(value)) {
        continue;
      }
      for (const [key, raw] of Object.entries(value)) {
        if (!isRecord(raw)) {
          errors.push(
            `${describeLocation({ file: mod.file, exportName, key })}: entry must be an object ` +
              'with name, description and category',
          );
          continue;
        }
        found += 1;
        const field = (name: string) => (typeof raw[name] === 'string' ? raw[name] : '');
        entries.push({
          file: mod.file,
          exportName,
          key,
          name: field('name'),
          description: field('description'),
          category: field('category'),
        });
      }
    }
    if (found === 0) {
      errors.push(
        `${mod.file}: no catalog entries found (expected an exported object of ` +
          '{ name, description, category } entries)',
      );
    }
  }
  return { entries, errors };
};

/** Returns one message per problem; an empty array means the catalog is valid. */
export const validateEntries = (entries: CollectedEntry[]): string[] => {
  const errors: string[] = [];
  const byName = new Map<string, CollectedEntry>();

  for (const entry of entries) {
    const where = describeLocation(entry);
    for (const fieldName of REQUIRED_FIELDS) {
      const value = entry[fieldName];
      if (!value.trim()) {
        errors.push(`${where}: ${fieldName} is empty or not a string`);
      } else if (value !== value.trim()) {
        errors.push(`${where}: ${fieldName} has leading or trailing whitespace`);
      }
    }
    const description = entry.description.trim();
    if (description && description.length < MIN_DESCRIPTION_LENGTH) {
      errors.push(
        `${where}: description is too short (${description.length} chars, minimum ${MIN_DESCRIPTION_LENGTH})`,
      );
    }
    const placeholder = PLACEHOLDER_PATTERN.exec(entry.description);
    if (placeholder) {
      errors.push(`${where}: description contains placeholder text "${placeholder[0]}"`);
    }

    if (!entry.name.trim()) {
      continue;
    }
    const first = byName.get(entry.name);
    if (!first) {
      byName.set(entry.name, entry);
    } else if (first.description !== entry.description || first.category !== entry.category) {
      errors.push(
        `Event "${entry.name}" is defined more than once with a different description or ` +
          `category: ${describeLocation(first)} and ${describeLocation(entry)}`,
      );
    }
  }
  return errors;
};

/** Keeps the first entry per event name (identical duplicates are allowed). */
export const dedupeEntries = (entries: CollectedEntry[]): CollectedEntry[] => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.name)) {
      return false;
    }
    seen.add(entry.name);
    return true;
  });
};
