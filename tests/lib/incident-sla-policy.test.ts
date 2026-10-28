import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { resolveNewIncidentSlaContract } from '@/lib/incident-sla/contract';
import {
  incidentSlaPolicyInputSchema,
  MAX_INCIDENT_SLA_TARGET_MS,
} from '@/lib/incident-sla/policy-validation';

const input = {
  scopeKey: 'service:s1',
  expectedVersion: 0,
  inheritWorkspace: false,
  baseAckTargetMs: 60000,
  baseResolveTargetMs: 120000,
  rules: [],
};
const workspace = {
  id: 'w1',
  scopeKey: 'workspace',
  version: 1,
  inheritWorkspace: false,
  baseAckTargetMs: 900000,
  baseResolveTargetMs: 7200000,
  rules: [],
};
const service = {
  ...workspace,
  id: 's2',
  scopeKey: 'service:s1',
  version: 2,
  baseAckTargetMs: 60000,
  baseResolveTargetMs: 120000,
  rules: [{ priority: 'P1', ackTargetMs: 1000, resolveTargetMs: 2000 }],
};
function transaction(policies: unknown[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(policies.map(snapshot => ({ snapshot }))),
  } as unknown as Prisma.TransactionClient;
}
const now = new Date('2026-09-07T00:00:00Z');

describe('versioned incident SLA validation', () => {
  it('accepts exact 24-day Int-safe boundary', () => {
    expect(MAX_INCIDENT_SLA_TARGET_MS).toBeLessThan(2 ** 31);
    expect(
      incidentSlaPolicyInputSchema.parse({
        ...input,
        baseResolveTargetMs: MAX_INCIDENT_SLA_TARGET_MS,
      })
    ).toBeDefined();
  });
  it.each([0, -1, 0.5, Infinity, NaN, 30 * 86400000])('rejects invalid target %s', target => {
    expect(
      incidentSlaPolicyInputSchema.safeParse({ ...input, baseResolveTargetMs: target }).success
    ).toBe(false);
  });
  it('rejects inverted base and rule targets and duplicate priorities', () => {
    expect(
      incidentSlaPolicyInputSchema.safeParse({ ...input, baseAckTargetMs: 120001 }).success
    ).toBe(false);
    const rule = { priority: 'P1', ackTargetMs: 10, resolveTargetMs: 20 };
    expect(incidentSlaPolicyInputSchema.safeParse({ ...input, rules: [rule, rule] }).success).toBe(
      false
    );
    expect(
      incidentSlaPolicyInputSchema.safeParse({ ...input, rules: [{ ...rule, ackTargetMs: 21 }] })
        .success
    ).toBe(false);
  });
  it('makes inheritance explicit and workspace base mandatory', () => {
    expect(
      incidentSlaPolicyInputSchema.safeParse({ ...input, inheritWorkspace: true }).success
    ).toBe(false);
    expect(
      incidentSlaPolicyInputSchema.safeParse({
        ...input,
        inheritWorkspace: true,
        baseAckTargetMs: null,
        baseResolveTargetMs: null,
      }).success
    ).toBe(true);
    expect(
      incidentSlaPolicyInputSchema.safeParse({
        ...input,
        scopeKey: 'workspace',
        inheritWorkspace: true,
        baseAckTargetMs: null,
        baseResolveTargetMs: null,
      }).success
    ).toBe(false);
    expect(incidentSlaPolicyInputSchema.safeParse({ ...input, surprise: true }).success).toBe(
      false
    );
  });
});

describe('new incident policy resolution', () => {
  it.each(['P1', 'p1', ' 1 '])(
    'resolves normalized %s service override with provenance',
    async priority => {
      expect(
        await resolveNewIncidentSlaContract(transaction([service, workspace]), {
          serviceId: 's1',
          priority,
          now,
        })
      ).toEqual({
        ackTargetMs: 1000,
        resolveTargetMs: 2000,
        source: 'SERVICE_PRIORITY_OVERRIDE',
        policyId: 's2',
        policyVersion: 2,
        policyRule: 'P1',
        capturedAt: now,
      });
    }
  );
  it.each(['P2', 'unknown', null])(
    'uses service base when priority %s has no rule',
    async priority => {
      expect(
        await resolveNewIncidentSlaContract(transaction([service, workspace]), {
          serviceId: 's1',
          priority,
          now,
        })
      ).toMatchObject({ ackTargetMs: 60000, source: 'SERVICE_DEFAULT', policyRule: 'BASE' });
    }
  );
  it('uses workspace only for explicit inheritance or missing service policy', async () => {
    for (const policies of [
      [workspace],
      [
        { ...service, inheritWorkspace: true, baseAckTargetMs: null, baseResolveTargetMs: null },
        workspace,
      ],
    ]) {
      expect(
        await resolveNewIncidentSlaContract(transaction(policies), {
          serviceId: 's1',
          priority: 'P2',
          now,
        })
      ).toMatchObject({ ackTargetMs: 900000, policyId: 'w1', source: 'WORKSPACE_DEFAULT' });
    }
  });
  it('resolves workspace priority between service priority and service base', async () => {
    const workspaceWithP2 = {
      ...workspace,
      rules: [{ priority: 'P2', ackTargetMs: 2000, resolveTargetMs: 4000 }],
    };
    expect(
      await resolveNewIncidentSlaContract(transaction([service, workspaceWithP2]), {
        serviceId: 's1',
        priority: 'P2',
        now,
      })
    ).toMatchObject({
      ackTargetMs: 2000,
      resolveTargetMs: 4000,
      source: 'WORKSPACE_PRIORITY_OVERRIDE',
      policyId: 'w1',
    });
  });
  it('keeps override precedence when service base inherits', async () => {
    expect(
      await resolveNewIncidentSlaContract(
        transaction([{ ...service, inheritWorkspace: true }, workspace]),
        { serviceId: 's1', priority: 'P1', now }
      )
    ).toMatchObject({ source: 'SERVICE_PRIORITY_OVERRIDE' });
  });
  it('fails closed without persisted defaults, never silently hardcodes targets', async () => {
    await expect(
      resolveNewIncidentSlaContract(transaction([]), { serviceId: 's1', now })
    ).rejects.toThrow('not configured');
  });
});
