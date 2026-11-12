// Post-sync verification. Amplitude answers some invalid PUTs (unknown category, renaming
// onto an existing name) with success=true but changes nothing, so every write is
// re-read and compared with what the catalog wants.
import type { CollectedEntry } from './catalog.ts';
import type { ExecutionResult } from './execute.ts';
import { desiredState } from './lifecycle.ts';
import { currentState, diffEvent, type AmplitudeEvent, type SyncPlan } from './plan.ts';

export type VerificationFailure = { name: string; message: string };

const MAX_VALUE_LENGTH = 120;

const show = (value: string | string[] | null | undefined): string => {
  if (Array.isArray(value)) {
    return `[${value.join(', ')}]`;
  }
  if (value === null || value === undefined) {
    return 'none';
  }
  const text = JSON.stringify(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}..."` : text;
};

const FIELDS = ['description', 'category', 'tags', 'displayName'] as const;
const FIELD_LABELS: Record<(typeof FIELDS)[number], string> = {
  description: 'description',
  category: 'category',
  tags: 'tags',
  displayName: 'display name',
};

/**
 * Compares every created/updated event with the re-read tracking plan. Events whose write
 * already failed are skipped; that failure is reported elsewhere.
 */
export const verifyWrites = (
  plan: SyncPlan,
  result: ExecutionResult,
  eventsAfter: AmplitudeEvent[],
): VerificationFailure[] => {
  const entries = new Map<string, CollectedEntry>([
    ...plan.create.map((e): [string, CollectedEntry] => [e.name, e]),
    ...plan.update.map((u): [string, CollectedEntry] => [u.entry.name, u.entry]),
  ]);
  const failed = new Set(result.failures.map((f) => f.name));
  const live = new Map(eventsAfter.filter((e) => !e.deleted).map((e) => [e.event_type, e]));
  const failures: VerificationFailure[] = [];

  for (const name of new Set([...result.created, ...result.updated])) {
    const entry = entries.get(name);
    if (!entry || failed.has(name)) {
      continue;
    }
    const event = live.get(name);
    if (!event) {
      failures.push({
        name,
        message: `write reported success but Amplitude shows no event named "${name}"`,
      });
      continue;
    }
    const desired = desiredState(entry);
    const current = currentState(event);
    const changes = diffEvent(desired, current);
    const fields = FIELDS.filter((field) => changes[field] !== undefined);
    if (fields.length) {
      const details = fields.map(
        (field) =>
          `${FIELD_LABELS[field]} ${show(current[field])} (expected ${show(desired[field])})`,
      );
      failures.push({
        name,
        message: `write reported success but Amplitude shows ${details.join('; ')}`,
      });
    }
  }
  return failures;
};
