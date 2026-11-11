import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  enabledOpsInsightAreas,
  highestSeverity,
  OPS_INSIGHT_AREA_KEYS,
  OPS_INSIGHT_LIMITS,
  opsInsightItemSchema,
  type OpsInsightSwitches,
} from '@/lib/intelligence/ops-insights/contract';
import {
  opsInsightsSubject,
  parseOpsInsightsSubject,
} from '@/lib/intelligence/ops-insights/handlers';
import { OPS_INSIGHT_PRODUCERS } from '@/lib/intelligence/ops-insights/producers';
import {
  integrationHealthProducer,
  type IntegrationHealthInput,
} from '@/lib/intelligence/ops-insights/producers/integration-health';

const OFF: OpsInsightSwitches = {
  opsInsightsEnabled: false,
  opsInsightsAutomationEnabled: false,
  opsInsightsEscalationEnabled: false,
  opsInsightsOnCallEnabled: false,
  opsInsightsPostmortemsEnabled: false,
  opsInsightsRunbooksEnabled: false,
  opsInsightsNotificationsEnabled: false,
};

describe('operations insight contract', () => {
  it('enables no area while the master switch is off, whatever the area switches say', () => {
    expect(enabledOpsInsightAreas(OFF)).toEqual([]);
    expect(enabledOpsInsightAreas({ ...OFF, opsInsightsRunbooksEnabled: true })).toEqual([]);
    expect(
      enabledOpsInsightAreas({
        ...OFF,
        opsInsightsEnabled: true,
        opsInsightsRunbooksEnabled: true,
        opsInsightsOnCallEnabled: true,
      })
    ).toEqual(['onCall', 'runbooks']);
    expect(OPS_INSIGHT_AREA_KEYS).toHaveLength(6);
  });

  it('caps evidence and accepts only in-app draft links', () => {
    const base = {
      severity: 'INFO',
      title: 'Title',
      summary: 'Summary',
      evidence: { facts: [{ label: 'A', value: '1' }] },
    };
    expect(opsInsightItemSchema.parse(base).key).toBe('');
    expect(opsInsightItemSchema.safeParse({ ...base, draftHref: '/services/1' }).success).toBe(
      true
    );
    for (const draftHref of ['https://example.com', '//example.com', '/\\example.com', 'services'])
      expect(opsInsightItemSchema.safeParse({ ...base, draftHref }).success, draftHref).toBe(false);
    const tooMany = Array.from({ length: OPS_INSIGHT_LIMITS.facts + 1 }, () => ({
      label: 'A',
      value: '1',
    }));
    expect(opsInsightItemSchema.safeParse({ ...base, evidence: { facts: tooMany } }).success).toBe(
      false
    );
    expect(opsInsightItemSchema.safeParse({ ...base, extra: true }).success).toBe(false);
  });

  it('ranks severities and round-trips work-item subjects', () => {
    expect(highestSeverity(['INFO', 'CRITICAL', 'WARNING'])).toBe('CRITICAL');
    expect(highestSeverity([])).toBe('INFO');
    expect(parseOpsInsightsSubject(opsInsightsSubject({ type: 'USER', id: 'a:b' }))).toEqual({
      type: 'USER',
      id: 'a:b',
    });
    for (const subject of ['', 'SERVICE', 'SERVICE:', 'NOPE:1', ':1'])
      expect(parseOpsInsightsSubject(subject), subject).toBeNull();
  });

  it('registers every kind once, in a known area', () => {
    const kinds = OPS_INSIGHT_PRODUCERS.map(producer => producer.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const producer of OPS_INSIGHT_PRODUCERS)
      expect(OPS_INSIGHT_AREA_KEYS).toContain(producer.area);
  });
});

describe('integration health (pure half)', () => {
  const healthy: IntegrationHealthInput = {
    serviceId: 'svc',
    silentDays: 0,
    silentHours: 1,
    weekBeforeLastAlert: 70,
    last24h: 10,
    priorWeek: 70,
    capped: false,
    recentSampled: 200,
    recentMissingSeverity: 0,
  };
  const keys = (input: Partial<IntegrationHealthInput>) =>
    integrationHealthProducer.derive({ ...healthy, ...input }).map(item => item.key);

  it('says nothing about a healthy service, and every item it emits satisfies the contract', () => {
    expect(keys({})).toEqual([]);
    const all = integrationHealthProducer.derive({
      ...healthy,
      silentDays: 2,
      silentHours: 50,
      last24h: 400,
      recentMissingSeverity: 190,
    });
    expect(all.map(item => item.key)).toEqual(['silent', 'volume-step', 'missing-severity']);
    for (const item of all) expect(opsInsightItemSchema.safeParse(item).success).toBe(true);
  });

  it('reports silence relative to the service’s own pace, and gives up after 30 days', () => {
    // 10 alerts a day: a day of silence is far beyond three usual gaps.
    expect(keys({ silentDays: 1, silentHours: 24, last24h: 0 })).toEqual(['silent']);
    expect(keys({ silentDays: 0, silentHours: 23, last24h: 0 })).toEqual([]);
    // One alert a day (gap 24 h): quiet for 2 days is not yet three gaps; 3 days is.
    expect(
      keys({ weekBeforeLastAlert: 7, silentDays: 2, silentHours: 48, priorWeek: 0, last24h: 0 })
    ).toEqual([]);
    expect(
      keys({ weekBeforeLastAlert: 7, silentDays: 3, silentHours: 72, priorWeek: 0, last24h: 0 })
    ).toEqual(['silent']);
    // Too few alerts to know its pace, or silent so long it was probably retired.
    expect(keys({ weekBeforeLastAlert: 3, silentDays: 9, silentHours: 216, last24h: 0 })).toEqual(
      []
    );
    expect(keys({ silentDays: 30, silentHours: 720, last24h: 0, priorWeek: 0 })).toEqual([]);
  });

  it('reports a volume step only against a real, uncapped baseline', () => {
    expect(keys({ last24h: 30 })).toEqual([]);
    expect(keys({ last24h: 60 })).toEqual(['volume-step']);
    expect(keys({ last24h: 60, capped: true })).toEqual([]);
    expect(keys({ last24h: 60, priorWeek: 14 })).toEqual([]);
    const drop = integrationHealthProducer.derive({ ...healthy, priorWeek: 700, last24h: 5 });
    expect(drop.map(item => [item.key, item.severity])).toEqual([['volume-step', 'INFO']]);
  });

  it('reports missing severity from a large enough sample, warning when nearly all lack it', () => {
    expect(keys({ recentSampled: 10, recentMissingSeverity: 10 })).toEqual([]);
    expect(keys({ recentMissingSeverity: 99 })).toEqual([]);
    const half = integrationHealthProducer.derive({ ...healthy, recentMissingSeverity: 100 });
    expect(half[0]).toMatchObject({ key: 'missing-severity', severity: 'INFO' });
    const most = integrationHealthProducer.derive({ ...healthy, recentMissingSeverity: 190 });
    expect(most[0]).toMatchObject({
      severity: 'WARNING',
      title: '95% of recent alerts have no severity',
      draftHref: '/services/svc/integrations',
    });
  });
});
