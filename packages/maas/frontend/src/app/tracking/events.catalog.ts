import type { EventCatalog } from '@odh-dashboard/analytics/catalog';

// Spike entries for the Amplitude description sync (scripts/amplitude-sync).
// These go to the production Amplitude project; the "TEST" prefix is required
// by the analytics team so they can be found and removed later.
export const maasEvents = {
  TEST_SYNC_A: {
    name: 'TEST Sync Test A',
    description: 'Test entry A from the description sync spike. Safe to delete.',
    category: 'TEST Sync Test',
    tags: ['team-maas'],
  },
  TEST_SYNC_B: {
    name: 'TEST Sync Test B',
    description: 'Test entry B from the description sync spike. Safe to delete.',
    category: 'TEST Sync Test',
    tags: ['team-maas'],
  },
  TEST_SYNC_C: {
    name: 'TEST Sync Test C',
    description: 'Test entry C from the description sync spike. Safe to delete.',
    category: 'TEST Sync Test',
    tags: ['team-maas'],
  },
} as const satisfies EventCatalog;
