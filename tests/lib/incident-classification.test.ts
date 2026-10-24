import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { resolveIncidentClassification } from '@/lib/incidents/classification';

const tx = (policy: unknown | null) =>
  ({
    incidentClassificationPolicy: {},
    $queryRaw: vi.fn().mockResolvedValue(policy ? [{ snapshot: policy }] : []),
  }) as unknown as Prisma.TransactionClient;

describe('incident classification', () => {
  it('preserves severity-to-urgency behavior without assigning priority by default', async () => {
    const result = await resolveIncidentClassification(
      tx({
        id: 'workspace-v1',
        scopeKey: 'workspace',
        version: 1,
        derivePriorityFromUrgency: false,
        rules: [
          {
            matchType: 'ALERT_SEVERITY',
            matchValue: 'critical',
            priority: null,
            urgency: 'HIGH',
          },
        ],
      }),
      { serviceId: 's1', integrationId: 'i1', alertSeverity: 'critical' }
    );

    expect(result).toMatchObject({
      priority: null,
      urgency: 'HIGH',
      prioritySource: 'NONE',
      urgencySource: 'CLASSIFICATION_RULE',
      policyId: 'workspace-v1',
      policyVersion: 1,
      rule: 'ALERT_SEVERITY:critical',
    });
  });

  it('allows an administrator to opt into severity-to-priority mapping', async () => {
    const result = await resolveIncidentClassification(
      tx({
        id: 'workspace-v2',
        scopeKey: 'workspace',
        version: 2,
        derivePriorityFromUrgency: false,
        rules: [
          {
            matchType: 'ALERT_SEVERITY',
            matchValue: 'critical',
            priority: 'P1',
            urgency: 'HIGH',
          },
        ],
      }),
      { serviceId: 's1', alertSeverity: 'critical' }
    );

    expect(result).toMatchObject({
      priority: 'P1',
      urgency: 'HIGH',
      prioritySource: 'CLASSIFICATION_RULE',
      policyId: 'workspace-v2',
    });
  });

  it('keeps explicit priority and urgency authoritative', async () => {
    expect(
      await resolveIncidentClassification(
        tx({
          id: 'workspace-v1',
          scopeKey: 'workspace',
          version: 1,
          derivePriorityFromUrgency: false,
          rules: [
            {
              matchType: 'ALERT_SEVERITY',
              matchValue: 'critical',
              priority: 'P1',
              urgency: 'HIGH',
            },
          ],
        }),
        {
          serviceId: 's1',
          explicitPriority: 'p4',
          explicitUrgency: 'LOW',
          alertSeverity: 'critical',
        }
      )
    ).toMatchObject({
      priority: 'P4',
      urgency: 'LOW',
      prioritySource: 'EXPLICIT',
      urgencySource: 'EXPLICIT',
      policyId: null,
      policyVersion: null,
    });
  });

  it('derives priority from urgency only when the workspace option is enabled', async () => {
    await expect(
      resolveIncidentClassification(
        tx({
          id: 'workspace-v3',
          scopeKey: 'workspace',
          version: 3,
          derivePriorityFromUrgency: true,
          rules: [],
        }),
        { serviceId: 's1', explicitUrgency: 'HIGH' }
      )
    ).resolves.toMatchObject({
      priority: 'P1',
      urgency: 'HIGH',
      prioritySource: 'URGENCY_FALLBACK',
      policyId: 'workspace-v3',
      rule: 'URGENCY_FALLBACK',
    });
  });

  it('preserves legacy severity behavior while policy storage is unavailable', async () => {
    const legacyTx = {} as Prisma.TransactionClient;
    await expect(
      resolveIncidentClassification(legacyTx, { serviceId: 's1', alertSeverity: 'warning' })
    ).resolves.toMatchObject({
      priority: null,
      urgency: 'MEDIUM',
      prioritySource: 'NONE',
      urgencySource: 'LEGACY_SEVERITY_DEFAULT',
      policyId: null,
    });
  });
});
