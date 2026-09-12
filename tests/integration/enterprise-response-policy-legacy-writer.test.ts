import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveIncidentClassification } from '@/lib/incidents/classification';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

describe('enterprise response-policy legacy writer compatibility', () => {
  beforeEach(resetDatabase);
  afterAll(async () => testPrisma.$disconnect());

  it('normalizes old policy and rule inserts without changing urgency-derived priority', async () => {
    const policyId = `legacy-policy-${Date.now()}`;
    const ruleId = `legacy-rule-${Date.now()}`;

    // Deliberately omit fields introduced by the enterprise migration, as a
    // rolling old application replica would do after the migration is live.
    await testPrisma.$executeRaw`
      INSERT INTO "IncidentClassificationPolicy"
        ("id", "scopeKey", "version", "inheritWorkspace", "derivePriorityFromUrgency")
      VALUES (${policyId}, 'workspace', 2, false, true)
    `;
    await testPrisma.$executeRaw`
      INSERT INTO "IncidentClassificationPolicyRule"
        ("id", "policyId", "matchType", "matchValue", "priority", "urgency")
      VALUES (${ruleId}, ${policyId}, 'ALERT_SEVERITY', 'critical', NULL, 'HIGH'::"IncidentUrgency")
    `;
    await testPrisma.$executeRaw`
      INSERT INTO "IncidentClassificationPolicyRule"
        ("id", "policyId", "matchType", "matchValue", "priority", "urgency")
      VALUES (${`${ruleId}-error`}, ${policyId}, 'ALERT_SEVERITY', 'error', NULL, 'MEDIUM'::"IncidentUrgency")
    `;
    await testPrisma.$executeRaw`
      INSERT INTO "IncidentClassificationPolicyRule"
        ("id", "policyId", "matchType", "matchValue", "priority", "urgency")
      VALUES (${`${ruleId}-warning`}, ${policyId}, 'ALERT_SEVERITY', 'warning', NULL, 'MEDIUM'::"IncidentUrgency")
    `;
    await testPrisma.$executeRaw`
      INSERT INTO "IncidentClassificationPolicyRule"
        ("id", "policyId", "matchType", "matchValue", "priority", "urgency")
      VALUES (${`${ruleId}-info`}, ${policyId}, 'ALERT_SEVERITY', 'info', NULL, 'LOW'::"IncidentUrgency")
    `;
    await testPrisma.incidentClassificationPolicy.update({
      where: { id: policyId },
      data: { sealedAt: new Date() },
    });

    const policy = await testPrisma.incidentClassificationPolicy.findUniqueOrThrow({
      where: { id: policyId },
      include: { rules: true },
    });
    expect(policy.priorityFallbackMode).toBe('ENABLED');
    expect(policy.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priorityMode: 'INHERIT', urgencyMode: 'SET' }),
      ])
    );

    const service = await createTestService('legacy classification writer');
    const classification = await testPrisma.$transaction(tx =>
      resolveIncidentClassification(tx, { serviceId: service.id, alertSeverity: 'critical' })
    );
    expect(classification).toMatchObject({ priority: 'P1', urgency: 'HIGH' });
  });
});
