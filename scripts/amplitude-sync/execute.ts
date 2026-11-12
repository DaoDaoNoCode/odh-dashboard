// Applies a SyncPlan with one write in flight at a time (Amplitude allows at most
// 4 concurrent cost units; each write costs 2).
import { AmplitudeApiError, type AmplitudeClient } from './amplitude.ts';
import type { SyncPlan } from './plan.ts';

export type WriteFailure = {
  action: 'create-category' | 'create' | 'update';
  name: string;
  message: string;
};

export type ExecutionResult = {
  categoriesCreated: string[];
  created: string[];
  /** Includes creates that hit 409 "already exists" and were applied with PUT. */
  updated: string[];
  failures: WriteFailure[];
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isConflict = (e: unknown) => e instanceof AmplitudeApiError && e.status === 409;

export const executePlan = async (
  plan: SyncPlan,
  client: AmplitudeClient,
  log: (message: string) => void = () => undefined,
): Promise<ExecutionResult> => {
  const result: ExecutionResult = { categoriesCreated: [], created: [], updated: [], failures: [] };

  for (const category of plan.categoriesToCreate) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.createCategory(category);
      result.categoriesCreated.push(category);
      log(`created category "${category}"`);
    } catch (e) {
      if (isConflict(e)) {
        log(`category "${category}" already exists`);
      } else {
        result.failures.push({ action: 'create-category', name: category, message: messageOf(e) });
      }
    }
  }

  for (const entry of plan.create) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.createEvent(entry);
      result.created.push(entry.name);
      log(`created "${entry.name}"`);
    } catch (e) {
      if (!isConflict(e)) {
        result.failures.push({ action: 'create', name: entry.name, message: messageOf(e) });
        continue;
      }
      log(`"${entry.name}" already exists (409), updating instead`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await client.updateEvent(entry.name, {
          description: entry.description,
          category: entry.category,
        });
        result.updated.push(entry.name);
      } catch (updateError) {
        result.failures.push({
          action: 'update',
          name: entry.name,
          message: messageOf(updateError),
        });
      }
    }
  }

  for (const { entry, changes } of plan.update) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await client.updateEvent(entry.name, changes);
      result.updated.push(entry.name);
      log(`updated "${entry.name}" (${Object.keys(changes).join(', ')})`);
    } catch (e) {
      result.failures.push({ action: 'update', name: entry.name, message: messageOf(e) });
    }
  }

  return result;
};
