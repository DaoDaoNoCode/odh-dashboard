// Plain-text (stdout) and markdown (GITHUB_STEP_SUMMARY) rendering. Pure functions.
import type { CollectedEntry } from './catalog.ts';
import type { ExecutionResult } from './execute.ts';
import type { SyncPlan } from './plan.ts';

export const escapeCell = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const bulletList = (items: string[], indent = '  '): string[] =>
  items.length ? items.map((item) => `${indent}- ${item}`) : [`${indent}(none)`];

export const renderCatalogText = (entries: CollectedEntry[], errors: string[]): string => {
  const lines = [`Catalog events: ${entries.length}`];
  for (const e of entries) {
    lines.push(`  - ${e.name} [${e.category}] (${e.file})`);
  }
  if (errors.length) {
    lines.push('', `Validation failed with ${errors.length} error(s):`, ...bulletList(errors));
  } else {
    lines.push('', 'Validation passed.');
  }
  return lines.join('\n');
};

export const renderCatalogMarkdown = (entries: CollectedEntry[], errors: string[]): string => {
  const lines = ['## Amplitude event catalog', ''];
  if (errors.length) {
    lines.push(`**Validation failed with ${errors.length} error(s):**`, '');
    lines.push(...errors.map((e) => `- ${e}`), '');
  } else {
    lines.push(`Validation passed. ${entries.length} event(s).`, '');
  }
  if (entries.length) {
    lines.push('| Event | Category | Description | Source |', '| --- | --- | --- | --- |');
    for (const e of entries) {
      lines.push(
        `| ${escapeCell(e.name)} | ${escapeCell(e.category)} | ${escapeCell(e.description)} | ` +
          `\`${escapeCell(e.file)}\` |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
};

type SyncReportInput = {
  plan: SyncPlan;
  /** null for dry runs. */
  result: ExecutionResult | null;
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

export const renderSyncText = (input: SyncReportInput): string => {
  const { plan, result } = input;
  const { created, updated, categories, labels } = outcome(input);
  const lines = [
    result ? 'Amplitude sync result' : 'Amplitude sync plan (DRY RUN, no changes made)',
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
  );
  if (result?.failures.length) {
    lines.push(
      `FAILED writes: ${result.failures.length}`,
      ...bulletList(result.failures.map((f) => `${f.action} "${f.name}": ${f.message}`)),
    );
  }
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
  const { plan, result } = input;
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
    `| In Amplitude, in no catalog | ${plan.untracked.total} |`,
  );
  if (result) {
    lines.push(`| Failed writes | ${result.failures.length} |`);
  }
  lines.push('');
  if (result?.failures.length) {
    lines.push(
      '### Failed writes',
      '',
      ...result.failures.map((f) => `- ${f.action} \`${f.name}\`: ${escapeCell(f.message)}`),
      '',
    );
  }
  lines.push(`### ${labels.created}`, '', ...mdList(created.map((n) => `\`${n}\``)), '');
  lines.push(`### ${labels.updated}`, '', ...mdList(updated.map((n) => `\`${n}\``)), '');
  lines.push('### Unchanged', '', ...mdList(plan.unchanged.map((e) => `\`${e.name}\``)), '');
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
