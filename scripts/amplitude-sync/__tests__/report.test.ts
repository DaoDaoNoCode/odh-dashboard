import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEntry, makeEvent, makeRename } from './fixtures.ts';
import { computePlan } from '../plan.ts';
import {
  renderCatalogMarkdown,
  renderCatalogText,
  renderSyncMarkdown,
  renderSyncText,
} from '../report.ts';

const STITCH =
  'Ask an Amplitude admin to merge "Old Saved" into "Form Saved" (Amplitude Data → ' +
  'Transformations → Merge events) so Funnels/Journeys see one history; until then use a ' +
  'custom event that ORs both.';

const lifecyclePlan = () =>
  computePlan(
    [
      ...makeRename('Old Saved', 'Form Saved'),
      makeEntry('Never Shipped', { status: 'removed', removedIn: '3.0' }),
      makeEntry('Case Clash'),
    ],
    [makeEvent('Old Saved'), makeEvent('Form Saved'), makeEvent('case clash')],
    [{ name: 'Forms' }],
  );

describe('sync report lifecycle sections', () => {
  it('renders conflicts, skipped entries, history and lifecycle counts as text', () => {
    const text = renderSyncText({ plan: lifecyclePlan(), result: null });
    assert.match(text, /Catalog lifecycle: 2 active, 1 deprecated, 1 removed/);
    assert.match(
      text,
      /Skipped \(never shipped\): 1\n {2}- Never Shipped \(removed; not created: never shipped\)/,
    );
    assert.match(
      text,
      /CONFLICTS: 1\n {2}- Catalog event "Case Clash" \(packages\/x\/events\.catalog\.ts \(xEvents\.CASE_CLASH\)\) was not created: Amplitude already has "case clash", which differs only by case\/space\./,
    );
    assert.ok(text.includes(`History to stitch: 1\n  - ${STITCH}`), text);
    assert.doesNotMatch(text, /VERIFICATION/);
  });

  it('renders verification failures', () => {
    const plan = lifecyclePlan();
    const result = { categoriesCreated: [], created: [], updated: ['Form Saved'], failures: [] };
    const verification = [{ name: 'Form Saved', message: 'write reported success but …' }];
    assert.match(
      renderSyncText({ plan, result, verification }),
      /VERIFICATION failures: 1\n {2}- "Form Saved": write reported success but …/,
    );
    const markdown = renderSyncMarkdown({ plan, result, verification });
    assert.match(markdown, /\| Verification failures \| 1 \|/);
    assert.match(markdown, /### Verification failures\n\n- `Form Saved`: write reported success/);
  });

  it('renders every section in the step summary markdown', () => {
    const markdown = renderSyncMarkdown({ plan: lifecyclePlan(), result: null });
    for (const row of [
      '| Skipped (never shipped) | 1 |',
      '| Conflicts | 1 |',
      '| Deprecated in catalog | 1 |',
      '| Removed in catalog | 1 |',
      '| History to stitch | 1 |',
    ]) {
      assert.ok(markdown.includes(row), row);
    }
    assert.match(markdown, /### Conflicts\n\n- Catalog event "Case Clash"/);
    assert.match(
      markdown,
      /### Skipped \(never shipped\)\n\n- `Never Shipped` \(removed; not created\)/,
    );
    assert.ok(
      markdown.includes(`### History to stitch\n\n- \`Old Saved\` → \`Form Saved\`: ${STITCH}`),
    );
    assert.doesNotMatch(markdown, /Verification failures/);
  });

  it('shows empty sections as none', () => {
    const plan = computePlan([makeEntry('A')], [makeEvent('A')], [{ name: 'Forms' }]);
    const text = renderSyncText({ plan, result: null });
    assert.match(text, /Skipped \(never shipped\): 0\n {2}\(none\)/);
    assert.match(text, /History to stitch: 0\n {2}\(none\)/);
    assert.doesNotMatch(text, /CONFLICTS/);
  });
});

describe('catalog report', () => {
  it('marks non-active entries and lists warnings', () => {
    const entries = [
      makeEntry('A'),
      makeEntry('B', { status: 'removed', removedIn: '1.0', category: 'Old' }),
    ];
    const text = renderCatalogText(entries, [], ['Event "B" was removed and is back']);
    assert.match(text, /- A \[Forms\] \(packages/);
    assert.match(text, /- B \[Old\] \(removed\) \(packages/);
    assert.match(
      text,
      /Warnings: 1\n {2}- Event "B" was removed and is back\n\nValidation passed\./,
    );

    const markdown = renderCatalogMarkdown(entries, [], ['careful']);
    assert.match(markdown, /\*\*Warnings:\*\*\n\n- careful/);
    assert.match(markdown, /\| B \| Old \| removed \| Fired when B happens in the UI\. \|/);
  });
});
