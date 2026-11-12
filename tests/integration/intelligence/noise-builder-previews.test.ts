import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/lib/authorization';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { createSuppressionRule, saveNoiseControlPolicy } from '@/lib/intelligence/noise-controls';
import {
  previewMaintenanceWindow,
  previewMatchers,
  previewOrchestrationRules,
  previewSuppressionRule,
} from '@/lib/intelligence/noise-controls/preview';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

// Only the session is replaced; the preview actions, domain code and database are real.
const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never))
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      return user;
    },
  };
});

import {
  previewMatchersAction,
  previewWindowAction,
} from '@/app/(app)/settings/intelligence/noise-controls/preview-actions';

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true };
const HOUR = 3_600_000;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  session.user = null;
});

/** Checkout (team SRE): 3 info alerts on staging, 2 critical on prod. Payments: 1 info alert. */
async function seed(now: Date) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  const team = await createTestTeam('SRE');
  const checkout = await createTestService('Checkout', team.id);
  const payments = await createTestService('Payments');
  const alerts: Array<{ serviceId: string; severity: string; env: string; at: Date }> = [
    {
      serviceId: checkout.id,
      severity: 'info',
      env: 'staging',
      at: new Date(now.getTime() - 50 * HOUR),
    },
    {
      serviceId: checkout.id,
      severity: 'info',
      env: 'staging',
      at: new Date(now.getTime() - 30 * HOUR),
    },
    {
      serviceId: checkout.id,
      severity: 'info',
      env: 'staging',
      at: new Date(now.getTime() - 10 * HOUR),
    },
    {
      serviceId: checkout.id,
      severity: 'critical',
      env: 'prod',
      at: new Date(now.getTime() - 20 * HOUR),
    },
    {
      serviceId: checkout.id,
      severity: 'critical',
      env: 'prod',
      at: new Date(now.getTime() - 5 * HOUR),
    },
    {
      serviceId: payments.id,
      severity: 'info',
      env: 'prod',
      at: new Date(now.getTime() - 8 * HOUR),
    },
    // Outside the 7-day window: never counted.
    {
      serviceId: checkout.id,
      severity: 'info',
      env: 'staging',
      at: new Date(now.getTime() - 9 * 24 * HOUR),
    },
  ];
  for (const [i, alert] of alerts.entries()) {
    const incident = await createTestIncident(`Alert ${i}`, alert.serviceId, {
      createdAt: alert.at,
      urgency: 'HIGH',
    });
    await db.alert.create({
      data: {
        incidentId: incident.id,
        serviceId: alert.serviceId,
        createdAt: alert.at,
        dedupKey: `key-${i}`,
        severity: alert.severity,
        fingerprintHash: `fp-${i}`,
        labels: { env: alert.env },
        payload: { summary: `Alert ${i} ${alert.severity}`, source: 'prometheus' },
      },
    });
  }
  return { admin, team, checkout, payments, alerts };
}

describe('previewMatchers (live match count)', () => {
  it('counts the last week of matching alerts, scoped to a service when asked', async () => {
    const now = new Date();
    const { checkout } = await seed(now);
    const all = await previewMatchers(
      settings,
      { matchers: [{ field: 'severity', op: 'equals', value: 'INFO' }] },
      now
    );
    expect(all).toMatchObject({
      days: 7,
      alertsScanned: 6,
      matchedAlerts: 4,
      matchedIncidents: 4,
      truncated: false,
    });
    expect(all.examples).toHaveLength(4);
    expect(all.examples[0].summary).toBe('Alert 5 info'); // newest first (Payments, 8 h ago)

    const scoped = await previewMatchers(
      settings,
      {
        matchers: [
          { field: 'severity', op: 'equals', value: 'info' },
          { field: 'label', key: 'env', op: 'equals', value: 'staging' },
        ],
        serviceId: checkout.id,
      },
      now
    );
    expect(scoped).toMatchObject({ alertsScanned: 5, matchedAlerts: 3 });
  });

  it('rejects unsafe conditions before touching the database', async () => {
    await expect(
      previewMatchers(settings, { matchers: [{ field: 'summary', op: 'regex', value: '(a+)+' }] })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('previewSuppressionRule', () => {
  it('replays only the unsaved rule, ignoring saved controls, and saves nothing', async () => {
    const now = new Date();
    const { admin, checkout } = await seed(now);
    const actor = { actorId: admin.id, source: 'UI' as const };
    // A saved catch-all rule and an ON policy must not leak into the preview.
    await createSuppressionRule(
      { name: 'Everything', matchers: [{ field: 'source', op: 'exists' }] },
      actor
    );
    await saveNoiseControlPolicy(
      { serviceId: null, mode: 'SHADOW', definition: { schemaVersion: 1 }, expectedRevision: 0 },
      actor
    );
    const before = await db.suppressionRule.count();
    const outcome = await previewSuppressionRule(
      settings,
      {
        name: 'Mute staging info',
        serviceId: checkout.id,
        matchers: [{ field: 'label', key: 'env', op: 'equals', value: 'staging' }],
        effect: 'SUPPRESS',
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      },
      admin.id,
      now
    );
    expect(outcome).toMatchObject({ incidentsEvaluated: 5, pagesAvoided: 3, failOpen: 0 });
    expect(outcome.byControl).toEqual({ SUPPRESSION: 3 });
    expect(outcome.bySource).toEqual({ 'preview-rule': 3 });
    expect(await db.suppressionRule.count()).toBe(before);
    const run = await db.intelligenceEvaluationRun.findUniqueOrThrow({
      where: { id: outcome.runId },
    });
    expect(run.status).toBe('COMPLETED');
  });
});

describe('previewMaintenanceWindow', () => {
  it('replays a future window at the same weekday and time in the last week', async () => {
    const now = new Date();
    const { admin, checkout, alerts } = await seed(now);
    // One week after the 10-hours-ago staging alert, for one hour around it.
    const target = alerts[2].at.getTime() + 7 * 24 * HOUR;
    const preview = await previewMaintenanceWindow(
      settings,
      {
        name: 'Next week',
        scope: 'SERVICE',
        serviceId: checkout.id,
        startsAt: new Date(target - 30 * 60_000).toISOString(),
        endsAt: new Date(target + 30 * 60_000).toISOString(),
        effect: 'SUPPRESS',
      },
      admin.id,
      now
    );
    expect(preview.shiftedWeeks).toBe(1);
    expect(preview.outcome).toMatchObject({ incidentsEvaluated: 5, pagesAvoided: 1 });
    expect(preview.outcome.byControl).toEqual({ MAINTENANCE: 1 });
    expect(await db.maintenanceWindow.count()).toBe(0);
  });

  it('expands recurrence and resolves team scope', async () => {
    const now = new Date();
    const { admin, team } = await seed(now);
    const preview = await previewMaintenanceWindow(
      settings,
      {
        name: 'Daily for the team',
        scope: 'TEAM',
        teamId: team.id,
        startsAt: new Date(now.getTime() - 6.5 * 24 * HOUR).toISOString(),
        endsAt: new Date(now.getTime() - 6.5 * 24 * HOUR + 23 * HOUR).toISOString(),
        recurrence: 'FREQ=DAILY',
        effect: 'DOWNGRADE',
        downgradeUrgency: 'LOW',
      },
      admin.id,
      now
    );
    expect(preview.shiftedWeeks).toBe(0);
    // Only Checkout belongs to the team; 23 of every 24 hours are covered, so most of its 5 incidents.
    expect(preview.outcome.downgraded).toBeGreaterThanOrEqual(4);
    expect(preview.outcome.downgraded).toBeLessThanOrEqual(5);
    expect(preview.outcome.examples.every(example => example.serviceId !== undefined)).toBe(true);
  });

  it('reports invalid recurrence as a validation error', async () => {
    const now = new Date();
    const { admin } = await seed(now);
    await expect(
      previewMaintenanceWindow(
        settings,
        {
          name: 'Bad',
          scope: 'ALL',
          startsAt: now.toISOString(),
          endsAt: new Date(now.getTime() + HOUR).toISOString(),
          recurrence: 'FREQ=HOURLY',
        },
        admin.id,
        now
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('previewOrchestrationRules', () => {
  it('counts per-rule matches in order, stopping at the first drop', async () => {
    const now = new Date();
    const { admin } = await seed(now);
    const outcome = await previewOrchestrationRules(
      settings,
      {
        rules: [
          {
            id: 'drop-info',
            name: 'Drop info',
            enabled: true,
            conditions: [{ field: 'severity', op: 'equals', value: 'info' }],
            actions: [{ type: 'DROP' }],
          },
          {
            id: 'label-all',
            name: 'Label everything',
            enabled: true,
            conditions: [{ field: 'source', op: 'exists' }],
            actions: [{ type: 'SET_LABEL', key: 'triaged', value: 'yes' }],
          },
        ],
      },
      admin.id,
      now
    );
    expect(outcome.incidentsEvaluated).toBe(6);
    expect(outcome.matchedRules).toEqual({ 'drop-info': 4, 'label-all': 2 });
    expect(outcome.bySource).toEqual({ 'drop-info': 4 });
    expect(outcome.byAction).toEqual({ DROP: 4, TRANSFORM: 2 });
  });
});

describe('preview actions', () => {
  it('require intelligence management and return serialisable results', async () => {
    const now = new Date();
    const { admin } = await seed(now);
    const responder = await createTestUser({ role: 'RESPONDER' });
    session.user = { id: responder.id, role: 'RESPONDER' };
    const denied = await previewMatchersAction({
      matchers: [{ field: 'severity', op: 'equals', value: 'info' }],
    });
    expect(denied.ok).toBe(false);

    session.user = { id: admin.id, role: 'ADMIN' };
    const allowed = await previewMatchersAction({
      matchers: [{ field: 'severity', op: 'equals', value: 'info' }],
    });
    expect(allowed).toMatchObject({ ok: true, data: { matchedAlerts: 4 } });

    const invalid = await previewWindowAction({ name: '', scope: 'ALL' });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message.length).toBeGreaterThan(0);
  });
});
