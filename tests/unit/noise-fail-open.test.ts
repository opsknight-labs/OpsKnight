import { describe, expect, it } from 'vitest';
import { compilePolicy } from '@/lib/intelligence/noise-controls/cache';
import {
  evaluatePrePagingControls,
  type PrePagingLookups,
  type PrePagingSnapshot,
} from '@/lib/intelligence/noise-controls/evaluate';
import type { PrePagingInput } from '@/lib/intelligence/noise-controls/contract';

/**
 * When the lookups run out of time the alert must still page, and an operator's orchestration rule that
 * raises its urgency must still apply: losing it would page a database outage as LOW.
 */
const NOW = new Date('2026-06-01T12:00:00Z');

const policy = compilePolicy({
  scopeKey: 'global',
  serviceId: null,
  mode: 'ON',
  revision: 1,
  definition: {
    schemaVersion: 1,
    contentDedup: { enabled: true },
    orchestration: {
      rules: [
        {
          id: 'raise-db',
          name: 'Database alerts are not low',
          conditions: [{ field: 'source', op: 'equals', value: 'prometheus' }],
          actions: [{ type: 'SET_URGENCY', value: 'MEDIUM' }],
        },
      ],
    },
  },
});
const snapshot: PrePagingSnapshot = {
  loadedAt: NOW.getTime(),
  policies: new Map([['global', policy]]),
  windows: [],
  rules: [],
  serviceTeams: new Map(),
  topology: new Map(),
};
const input: PrePagingInput = {
  serviceId: 'svc-1',
  source: 'prometheus',
  summary: 'Primary database down',
  severity: 'warning',
  urgency: 'LOW',
  labels: {},
  resourceKey: null,
  fingerprintHash: 'abc',
  dedupKey: 'db-down',
  receivedAt: NOW,
};
const never = () => new Promise<never>(() => {});
const hanging: PrePagingLookups = {
  findOpenIncidentByFingerprint: never,
  countRecentIncidents: never,
  findStormParent: never,
  recentAlertStatuses: never,
};
const failing: PrePagingLookups = {
  findOpenIncidentByFingerprint: async () => {
    throw new Error('lookup pool down');
  },
  countRecentIncidents: async () => 0,
  findStormParent: async () => null,
  recentAlertStatuses: async () => [],
};

describe('orchestration survives a failed lookup (N15)', () => {
  it('still raises urgency above LOW when the lookups miss the deadline', async () => {
    const decision = await evaluatePrePagingControls(input, snapshot, hanging, {
      now: NOW,
      deadlineMs: 5,
    });
    expect(decision.action).toBe('TRANSFORM');
    expect(decision.transform?.urgency).toBe('MEDIUM');
    expect(decision.apply).toBe(true);
  });

  it('still raises urgency above LOW when a lookup throws', async () => {
    const decision = await evaluatePrePagingControls(input, snapshot, failing, {
      now: NOW,
      deadlineMs: 50,
    });
    expect(decision.action).toBe('TRANSFORM');
    expect(decision.transform?.urgency).toBe('MEDIUM');
  });
});
