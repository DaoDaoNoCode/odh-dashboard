// Catalog discovery, loading, collection and validation. No network access.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DESCRIPTION_MAX_LENGTH,
  EVENT_STATUSES,
  MANAGED_TAGS,
  TAG_PATTERN,
  effectiveDescription,
  normalizeName,
} from './lifecycle.ts';

export const CATALOG_PATHSPEC = '*events.catalog.ts';
export const CATALOG_SUFFIX = 'events.catalog.ts';
export const MIN_DESCRIPTION_LENGTH = 20;
const PLACEHOLDER_PATTERN = /\b(TODO|TBD|FIXME)\b/i;
const REQUIRED_FIELDS = ['name', 'description', 'category'] as const;
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  ...REQUIRED_FIELDS,
  'status',
  'deprecated',
  'removedIn',
  'previousNames',
  'displayName',
  'tags',
  'properties',
]);

export type Deprecation = { since: string; reason: string; replacedBy?: string };

export type CollectedEntry = {
  /** Repo-relative path of the catalog file. */
  file: string;
  exportName: string;
  key: string;
  name: string;
  description: string;
  category: string;
  /** As written in the catalog ('active' when omitted); validateEntries checks the value. */
  status: string;
  deprecated?: Deprecation;
  removedIn?: string;
  previousNames: string[];
  displayName?: string;
  tags: string[];
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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

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

type EntryFields = Omit<CollectedEntry, 'file' | 'exportName' | 'key'>;

/** Reads one raw entry. Wrong types are reported and treated as missing. */
const readEntry = (raw: Record<string, unknown>, where: string, errors: string[]): EntryFields => {
  const text = (name: string) => (typeof raw[name] === 'string' ? raw[name] : '');
  const optionalText = (name: string): string | undefined => {
    const value = raw[name];
    if (value === undefined || typeof value === 'string') {
      return value;
    }
    errors.push(`${where}: ${name} must be a string`);
    return undefined;
  };
  const stringList = (name: string): string[] => {
    const value = raw[name];
    if (value === undefined) {
      return [];
    }
    if (isStringArray(value)) {
      return [...value];
    }
    errors.push(`${where}: ${name} must be an array of strings`);
    return [];
  };

  for (const field of Object.keys(raw)) {
    if (field === 'owner') {
      errors.push(
        `${where}: owner is not supported (Amplitude only accepts existing users); ` +
          "use a tag such as 'team-maas' instead",
      );
    } else if (!KNOWN_FIELDS.has(field)) {
      errors.push(`${where}: unknown field "${field}"`);
    }
  }

  let deprecated: Deprecation | undefined;
  if (isRecord(raw.deprecated)) {
    const { since, reason, replacedBy } = raw.deprecated;
    deprecated = {
      since: typeof since === 'string' ? since : '',
      reason: typeof reason === 'string' ? reason : '',
    };
    if (typeof replacedBy === 'string') {
      deprecated.replacedBy = replacedBy;
    } else if (replacedBy !== undefined) {
      errors.push(`${where}: deprecated.replacedBy must be a string`);
    }
  } else if (raw.deprecated !== undefined) {
    errors.push(`${where}: deprecated must be an object with since and reason`);
  }

  const removedIn = optionalText('removedIn');
  const displayName = optionalText('displayName');
  return {
    name: text('name'),
    description: text('description'),
    category: text('category'),
    status: optionalText('status') ?? 'active',
    ...(deprecated && { deprecated }),
    ...(removedIn !== undefined && { removedIn }),
    previousNames: stringList('previousNames'),
    ...(displayName !== undefined && { displayName }),
    tags: stringList('tags'),
  };
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
        const location = { file: mod.file, exportName, key };
        if (!isRecord(raw)) {
          errors.push(
            `${describeLocation(location)}: entry must be an object ` +
              'with name, description and category',
          );
          continue;
        }
        found += 1;
        entries.push({ ...location, ...readEntry(raw, describeLocation(location), errors) });
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

/** The fields that end up in Amplitude or drive the lifecycle; used to compare duplicates. */
const syncedFields = (entry: CollectedEntry): string =>
  JSON.stringify([
    entry.description,
    entry.category,
    entry.status,
    entry.deprecated ?? null,
    entry.removedIn ?? null,
    entry.previousNames,
    entry.displayName ?? null,
    entry.tags.toSorted(),
  ]);

const checkText = (errors: string[], where: string, label: string, value: string) => {
  if (!value.trim()) {
    errors.push(`${where}: ${label} is empty or not a string`);
  } else if (value !== value.trim()) {
    errors.push(`${where}: ${label} has leading or trailing whitespace`);
  }
};

/** Rules that only look at one entry. */
const validateEntry = (entry: CollectedEntry, errors: string[]) => {
  const where = describeLocation(entry);
  for (const fieldName of REQUIRED_FIELDS) {
    checkText(errors, where, fieldName, entry[fieldName]);
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

  const { status } = entry;
  const knownStatus = EVENT_STATUSES.some((s) => s === status);
  if (!knownStatus) {
    errors.push(`${where}: status "${status}" must be one of ${EVENT_STATUSES.join(', ')}`);
  }
  if (entry.deprecated) {
    checkText(errors, where, 'deprecated.since', entry.deprecated.since);
    checkText(errors, where, 'deprecated.reason', entry.deprecated.reason);
    if (entry.deprecated.replacedBy !== undefined) {
      checkText(errors, where, 'deprecated.replacedBy', entry.deprecated.replacedBy);
    }
    if (status === 'active') {
      errors.push(`${where}: deprecated is only allowed with status 'deprecated' or 'removed'`);
    }
  } else if (status === 'deprecated') {
    errors.push(`${where}: status 'deprecated' requires deprecated: { since, reason }`);
  }
  if (entry.removedIn !== undefined) {
    checkText(errors, where, 'removedIn', entry.removedIn);
    if (status !== 'removed') {
      errors.push(`${where}: removedIn is only allowed with status 'removed'`);
    }
  } else if (status === 'removed') {
    errors.push(`${where}: status 'removed' requires removedIn (release, version or ISO date)`);
  }

  if (entry.displayName !== undefined) {
    checkText(errors, where, 'displayName', entry.displayName);
  }
  for (const tag of entry.tags) {
    if (!TAG_PATTERN.test(tag)) {
      errors.push(`${where}: tag "${tag}" must be lowercase kebab-case (e.g. team-maas)`);
    } else if (MANAGED_TAGS.includes(tag)) {
      errors.push(`${where}: tag "${tag}" is set by the sync; remove it from tags`);
    }
  }
  if (new Set(entry.tags).size !== entry.tags.length) {
    errors.push(`${where}: tags contain duplicates`);
  }

  const { length } = effectiveDescription(entry);
  if (length > DESCRIPTION_MAX_LENGTH) {
    errors.push(
      `${where}: description with the lifecycle prefix/suffix is ${length} chars; ` +
        `Amplitude allows at most ${DESCRIPTION_MAX_LENGTH}`,
    );
  }
};

/** Returns one message per problem; an empty array means the catalog is valid. */
export const validateEntries = (entries: CollectedEntry[]): string[] => {
  const errors: string[] = [];
  const byName = new Map<string, CollectedEntry>();

  for (const entry of entries) {
    validateEntry(entry, errors);
    if (!entry.name.trim()) {
      continue;
    }
    const first = byName.get(entry.name);
    if (!first) {
      byName.set(entry.name, entry);
    } else if (syncedFields(first) !== syncedFields(entry)) {
      errors.push(
        `Event "${entry.name}" is defined more than once with different values: ` +
          `${describeLocation(first)} and ${describeLocation(entry)}`,
      );
    }
  }

  // Names that only differ by case/whitespace become separate Amplitude events.
  const byNormalized = new Map<string, CollectedEntry[]>();
  for (const entry of byName.values()) {
    const key = normalizeName(entry.name);
    byNormalized.set(key, [...(byNormalized.get(key) ?? []), entry]);
  }
  for (const group of byNormalized.values()) {
    if (group.length > 1) {
      errors.push(
        `Events ${group.map((e) => `"${e.name}" (${describeLocation(e)})`).join(', ')} ` +
          'would create separate Amplitude events that differ only by case/space',
      );
    }
  }

  const listedBy = new Map<string, string>();
  for (const entry of byName.values()) {
    const where = describeLocation(entry);
    const replacedBy = entry.deprecated?.replacedBy;
    if (replacedBy !== undefined && replacedBy.trim()) {
      const replacement = byName.get(replacedBy);
      if (replacedBy === entry.name) {
        errors.push(`${where}: deprecated.replacedBy cannot name the event itself`);
      } else if (!replacement) {
        errors.push(`${where}: deprecated.replacedBy "${replacedBy}" is not in the catalog`);
      } else if (replacement.status !== 'active') {
        errors.push(
          `${where}: deprecated.replacedBy "${replacedBy}" has status '${replacement.status}'; ` +
            'it must name an active event',
        );
      }
    }

    for (const previous of entry.previousNames) {
      const owner = listedBy.get(previous);
      if (owner !== undefined) {
        errors.push(
          owner === entry.name
            ? `${where}: previousNames lists "${previous}" more than once`
            : `"${previous}" is listed in previousNames of both "${owner}" and "${entry.name}"`,
        );
        continue;
      }
      listedBy.set(previous, entry.name);
      if (previous === entry.name) {
        errors.push(`${where}: previousNames cannot list the event itself`);
        continue;
      }
      const old = byName.get(previous);
      if (!old) {
        errors.push(
          `${where}: previousNames "${previous}" is not in the catalog. Keep the old event ` +
            `as an entry with status 'deprecated' (or 'removed') and deprecated.replacedBy ` +
            `"${entry.name}"`,
        );
      } else if (old.status !== 'deprecated' && old.status !== 'removed') {
        errors.push(
          `${where}: previousNames "${previous}" has status '${old.status}'; ` +
            "it must be 'deprecated' or 'removed'",
        );
      } else if (old.deprecated?.replacedBy !== entry.name) {
        errors.push(
          `${where}: previousNames "${previous}" must set deprecated.replacedBy "${entry.name}"`,
        );
      }
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
