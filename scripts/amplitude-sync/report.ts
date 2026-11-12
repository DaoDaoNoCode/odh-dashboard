// Plain-text (stdout) and markdown (GITHUB_STEP_SUMMARY) rendering. Pure functions.
import { describeLocation, type CollectedEntry } from './catalog.ts';
import type { ExecutionResult } from './execute.ts';
import type { HistoryToStitch, NameConflict, SyncPlan } from './plan.ts';
import type { VerificationFailure } from './verify.ts';

export const escapeCell = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const bulletList = (items: string[], indent = '  '): string[] =>
  items.length ? items.map((item) => `${indent}- ${item}`) : [`${indent}(none)`];

const statusSuffix = (entry: CollectedEntry) =>
  entry.status === 'active' ? '' : ` (${entry.status})`;

export const renderCatalogText = (
  entries: CollectedEntry[],
  errors: string[],
  warnings: string[] = [],
): string => {
  const lines = [`Catalog events: ${entries.length}`];
  for (const e of entries) {
    lines.push(`  - ${e.name} [${e.category}]${statusSuffix(e)} (${e.file})`);
  }
  if (warnings.length) {
    lines.push('', `Warnings: ${warnings.length}`, ...bulletList(warnings));
  }
  if (errors.length) {
    lines.push('', `Validation failed with ${errors.length} error(s):`, ...bulletList(errors));
  } else {
    lines.push('', 'Validation passed.');
  }
  return lines.join('\n');
};

export const renderCatalogMarkdown = (
  entries: CollectedEntry[],
  errors: string[],
  warnings: string[] = [],
): string => {
  const lines = ['## Amplitude event catalog', ''];
  if (errors.length) {
    lines.push(`**Validation failed with ${errors.length} error(s):**`, '');
    lines.push(...errors.map((e) => `- ${e}`), '');
  } else {
    lines.push(`Validation passed. ${entries.length} event(s).`, '');
  }
  if (warnings.length) {
    lines.push('**Warnings:**', '', ...warnings.map((w) => `- ${w}`), '');
  }
  if (entries.length) {
    lines.push(
      '| Event | Category | Status | Description | Source |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const e of entries) {
      lines.push(
        `| ${escapeCell(e.name)} | ${escapeCell(e.category)} | ${escapeCell(e.status)} | ` +
          `${escapeCell(e.description)} | \`${escapeCell(e.file)}\` |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
};

type SyncReportInput = {
  plan: SyncPlan;
  /** null for dry runs. */
  result: ExecutionResult | null;
  /** Post-sync verification; null or omitted when it did not run. */
  verification?: VerificationFailure[] | null;
};

const outcome = ({ plan, result }: SyncReportInput) => {
  if (!result) {
    return {
      created: plan.create.map((e) => e.name),
      updated: plan.update.map((u) => u.entry.name),
      categories: plan.categoriesToCreate,
      labels: { categories: 'Categories to create', created: 'To create', updated: 'To update' },
    };
  }
  return {
    created: result.created,
    updated: result.updated,
    categories: result.categoriesCreated,
    labels: { categories: 'Categories created', created: 'Created', updated: 'Updated' },
  };
};

export const conflictMessage = ({ entry, existing }: NameConflict): string =>
  `Catalog event "${entry.name}" (${describeLocation(entry)}) was not created: Amplitude ` +
  `already has ${existing.map((n) => `"${n}"`).join(', ')}, which differs only by case/space. ` +
  'Use the exact shipped name in the catalog.';

export const historyMessage = ({ oldName, newName }: HistoryToStitch): string =>
  `Ask an Amplitude admin to merge "${oldName}" into "${newName}" (Amplitude Data → ` +
  'Transformations → Merge events) so Funnels/Journeys see one history; until then use a ' +
  'custom event that ORs both.';

const skippedMessage = (entry: CollectedEntry) =>
  `${entry.name} (${entry.status}; not created: never shipped)`;

const lifecycleLine = ({ lifecycle }: SyncPlan) =>
  `${lifecycle.active} active, ${lifecycle.deprecated} deprecated, ${lifecycle.removed} removed`;

export const renderSyncText = (input: SyncReportInput): string => {
  const { plan, result, verification } = input;
  const { created, updated, categories, labels } = outcome(input);
  const lines = [
    result ? 'Amplitude sync result' : 'Amplitude sync plan (DRY RUN, no changes made)',
    `Catalog lifecycle: ${lifecycleLine(plan)}`,
    `${labels.categories}: ${categories.length}`,
    ...bulletList(categories),
    `${labels.created}: ${created.length}`,
    ...bulletList(created),
    `${labels.updated}: ${updated.length}`,
  ];
  for (const name of updated) {
    const planned = plan.update.find((u) => u.entry.name === name);
    lines.push(
      planned ? `  - ${name} (${Object.keys(planned.changes).join(', ')})` : `  - ${name}`,
    );
  }
  if (!updated.length) {
    lines.push('  (none)');
  }
  lines.push(
    `Unchanged: ${plan.unchanged.length}`,
    ...bulletList(plan.unchanged.map((e) => e.name)),
    `Skipped (never shipped): ${plan.skipped.length}`,
    ...bulletList(plan.skipped.map(skippedMessage)),
  );
  if (plan.conflicts.length) {
    lines.push(
      `CONFLICTS: ${plan.conflicts.length}`,
      ...bulletList(plan.conflicts.map(conflictMessage)),
    );
  }
  if (result?.failures.length) {
    lines.push(
      `FAILED writes: ${result.failures.length}`,
      ...bulletList(result.failures.map((f) => `${f.action} "${f.name}": ${f.message}`)),
    );
  }
  if (verification?.length) {
    lines.push(
      `VERIFICATION failures: ${verification.length}`,
      ...bulletList(verification.map((v) => `"${v.name}": ${v.message}`)),
    );
  }
  lines.push(
    `History to stitch: ${plan.history.length}`,
    ...bulletList(plan.history.map(historyMessage)),
  );
  const { untracked } = plan;
  lines.push(
    `In Amplitude but in no catalog: ${untracked.total} ` +
      `(${untracked.builtInCount} Amplitude built-ins not listed)`,
    ...bulletList(untracked.listed),
  );
  return lines.join('\n');
};

const mdList = (items: string[]) => (items.length ? items.map((i) => `- ${i}`) : ['_none_']);

export const renderSyncMarkdown = (input: SyncReportInput): string => {
  const { plan, result, verification } = input;
  const { created, updated, categories, labels } = outcome(input);
  const lines = [result ? '## Amplitude sync result' : '## Amplitude sync plan (dry run)', ''];
  if (!result) {
    lines.push('> No changes were made.', '');
  }
  lines.push(
    `| | Count |`,
    `| --- | --- |`,
    `| ${labels.categories} | ${categories.length} |`,
    `| ${labels.created} | ${created.length} |`,
    `| ${labels.updated} | ${updated.length} |`,
    `| Unchanged | ${plan.unchanged.length} |`,
    `| Skipped (never shipped) | ${plan.skipped.length} |`,
    `| Conflicts | ${plan.conflicts.length} |`,
    `| Deprecated in catalog | ${plan.lifecycle.deprecated} |`,
    `| Removed in catalog | ${plan.lifecycle.removed} |`,
    `| History to stitch | ${plan.history.length} |`,
    `| In Amplitude, in no catalog | ${plan.untracked.total} |`,
  );
  if (result) {
    lines.push(`| Failed writes | ${result.failures.length} |`);
  }
  if (verification) {
    lines.push(`| Verification failures | ${verification.length} |`);
  }
  lines.push('');
  if (plan.conflicts.length) {
    lines.push(
      '### Conflicts',
      '',
      ...plan.conflicts.map((c) => `- ${escapeCell(conflictMessage(c))}`),
      '',
    );
  }
  if (result?.failures.length) {
    lines.push(
      '### Failed writes',
      '',
      ...result.failures.map((f) => `- ${f.action} \`${f.name}\`: ${escapeCell(f.message)}`),
      '',
    );
  }
  if (verification?.length) {
    lines.push(
      '### Verification failures',
      '',
      ...verification.map((v) => `- \`${v.name}\`: ${escapeCell(v.message)}`),
      '',
    );
  }
  lines.push(`### ${labels.created}`, '', ...mdList(created.map((n) => `\`${n}\``)), '');
  lines.push(`### ${labels.updated}`, '', ...mdList(updated.map((n) => `\`${n}\``)), '');
  lines.push('### Unchanged', '', ...mdList(plan.unchanged.map((e) => `\`${e.name}\``)), '');
  lines.push(
    '### Skipped (never shipped)',
    '',
    ...mdList(plan.skipped.map((e) => `\`${e.name}\` (${e.status}; not created)`)),
    '',
  );
  lines.push(
    '### History to stitch',
    '',
    ...mdList(plan.history.map((h) => `\`${h.oldName}\` → \`${h.newName}\`: ${historyMessage(h)}`)),
    '',
  );
  lines.push(
    '<details><summary>In Amplitude but in no catalog: ' +
      `${plan.untracked.listed.length} listed, ${plan.untracked.builtInCount} Amplitude built-ins ` +
      'not listed</summary>',
    '',
    ...mdList(plan.untracked.listed.map((n) => `\`${n}\``)),
    '',
    '</details>',
  );
  return `${lines.join('\n')}\n`;
};
