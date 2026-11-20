import { describe, expect, it } from 'vitest';
import { getAuthorizedNavItems, NAVIGATION_ITEMS } from '@/config/navigation';
import { APP_ROLES, CAPABILITIES, hasCapability } from '@/lib/authorization';
import { MOBILE_MORE_ROUTES } from '@/components/mobile/mobileNavItems';
import {
  ALERT_DECISION_KINDS,
  ALERT_DECISION_OPTIONS,
  CHANGE_RISK_BANDS,
  CHANGE_RISK_OPTIONS,
  changeRiskBand,
  classifyAlertDecision,
  decodeListCursor,
  DEFAULT_LIST_WINDOW,
  encodeListCursor,
  listQueryString,
  parseAlertListFilters,
  parseChangeListFilters,
  parseListId,
} from '@/lib/intelligence/lists/contract';

describe('list cursor', () => {
  it('round-trips a position', () => {
    const cursor = { at: new Date('2026-11-10T12:34:56.789Z'), id: 'cmabc123_-XY' };
    const decoded = decodeListCursor(encodeListCursor(cursor));
    expect(decoded?.at.toISOString()).toBe(cursor.at.toISOString());
    expect(decoded?.id).toBe(cursor.id);
  });

  it.each([
    undefined,
    '',
    'nodot',
    '.id',
    'zzzzzzzzzzzzzzzzzzzz.id',
    'abc.',
    "abc.id' OR 1=1",
    'ABC.id',
    `abc.${'x'.repeat(65)}`,
    `${'a'.repeat(200)}.id`,
    '-5.id',
  ])('rejects a malformed cursor (%s) instead of passing it to a query', value => {
    expect(decodeListCursor(value)).toBeNull();
  });

  it('reads the first value when the parameter is repeated', () => {
    const encoded = encodeListCursor({ at: new Date(1_700_000_000_000), id: 'a1' });
    expect(decodeListCursor([encoded, 'junk'])?.id).toBe('a1');
  });
});

describe('list filters', () => {
  it('defaults to the last 24 hours with no filters', () => {
    expect(parseAlertListFilters()).toEqual({
      serviceId: null,
      severity: null,
      decision: null,
      window: DEFAULT_LIST_WINDOW,
      cursor: null,
    });
    expect(parseChangeListFilters({})).toEqual({
      serviceId: null,
      source: null,
      risk: null,
      window: DEFAULT_LIST_WINDOW,
      cursor: null,
    });
  });

  it('accepts known values and drops anything else', () => {
    expect(
      parseAlertListFilters({
        service: 'svc_1',
        severity: 'CRITICAL',
        decision: 'Suppressed',
        window: '7d',
      })
    ).toMatchObject({
      serviceId: 'svc_1',
      severity: 'critical',
      decision: 'suppressed',
      window: '7d',
    });
    expect(
      parseAlertListFilters({
        service: 'bad id!',
        severity: 'fatal',
        decision: 'held',
        window: '90d',
      })
    ).toMatchObject({
      serviceId: null,
      severity: null,
      decision: null,
      window: DEFAULT_LIST_WINDOW,
    });
    expect(parseChangeListFilters({ source: 'github-actions', risk: 'HIGH' })).toMatchObject({
      source: 'github-actions',
      risk: 'high',
    });
    expect(parseChangeListFilters({ source: 'x'.repeat(121), risk: 'extreme' })).toMatchObject({
      source: null,
      risk: null,
    });
  });

  it('bounds ids from the URL', () => {
    expect(parseListId('cm123')).toBe('cm123');
    expect(parseListId('a'.repeat(65))).toBeNull();
    expect(parseListId('a/b')).toBeNull();
  });

  it('builds shareable query strings without default values', () => {
    expect(listQueryString({ service: null, window: DEFAULT_LIST_WINDOW })).toBe('');
    expect(
      listQueryString({ service: 's1', severity: 'critical', window: '7d', cursor: 'c.1' })
    ).toBe('?service=s1&severity=critical&window=7d&cursor=c.1');
  });

  it('offers one option per filterable value', () => {
    expect(ALERT_DECISION_OPTIONS.map(option => option.value)).toEqual([...ALERT_DECISION_KINDS]);
    expect(CHANGE_RISK_OPTIONS.map(option => option.value)).toEqual([...CHANGE_RISK_BANDS]);
  });
});

describe('noise decision and risk labels', () => {
  it.each([
    ['MAINTENANCE', 'SUPPRESS', 'maintenance'],
    ['SUPPRESSION', 'SUPPRESS', 'suppressed'],
    ['ORCHESTRATION', 'DROP', 'suppressed'],
    ['CONTENT_DEDUP', 'APPEND', 'deduped'],
    ['STORM', 'GROUP_CHILD', 'grouped'],
    ['FLAPPING', 'HOLD', 'held'],
    ['ORCHESTRATION', 'DOWNGRADE', 'downgraded'],
    ['ORCHESTRATION', 'TRANSFORM', 'transformed'],
  ])('%s/%s reads as %s', (control, action, expected) => {
    expect(classifyAlertDecision(control, action)).toBe(expected);
  });

  it('shows nothing for a control that did nothing', () => {
    expect(classifyAlertDecision('SUPPRESSION', 'NONE')).toBeNull();
    expect(classifyAlertDecision('SUPPRESSION', 'SOMETHING_NEW')).toBeNull();
  });

  it('bands risk and never invents a score', () => {
    expect(changeRiskBand(null)).toBe('unscored');
    expect(changeRiskBand(Number.NaN)).toBe('unscored');
    expect(changeRiskBand(0.6)).toBe('high');
    expect(changeRiskBand(0.59)).toBe('medium');
    expect(changeRiskBand(0.35)).toBe('medium');
    expect(changeRiskBand(0.1)).toBe('low');
  });
});

describe('alerts and changes navigation', () => {
  it.each(['/alerts', '/changes'])(
    '%s sits under MAIN for exactly the roles that hold INTELLIGENCE_READ',
    href => {
      const item = NAVIGATION_ITEMS.find(entry => entry.href === href);
      expect(item?.section).toBe('MAIN');
      const expected = APP_ROLES.filter(role =>
        hasCapability(role, CAPABILITIES.INTELLIGENCE_READ)
      );
      for (const role of APP_ROLES)
        expect(
          getAuthorizedNavItems(role)
            .map(entry => entry.href)
            .includes(href)
        ).toBe(expected.includes(role));
    }
  );

  it('keeps the mobile More tab highlighted on the AIOps page', () => {
    expect(MOBILE_MORE_ROUTES).toContain('/m/intelligence');
  });
});

describe('one noise-decision vocabulary across incident, lists and service surfaces', () => {
  it('gives the alerts list the same kinds, labels and classifier the incident surfaces use', async () => {
    const explain = await import('@/lib/intelligence/incident-ux/explain');
    const lists = await import('@/lib/intelligence/lists/contract');
    expect(lists.ALERT_DECISION_LABELS).toBe(explain.NOISE_DECISION_LABELS);
    expect(lists.classifyAlertDecision).toBe(explain.classifyNoiseDecision);
    for (const kind of ALERT_DECISION_KINDS) expect(explain.NOISE_DECISION_KINDS).toContain(kind);
    // Every kind has a label and a status tone, so no surface invents its own.
    for (const kind of explain.NOISE_DECISION_KINDS) {
      // eslint-disable-next-line security/detect-object-injection -- kind iterates a fixed exported list
      expect(explain.NOISE_DECISION_LABELS[kind]).toBeTruthy();
      // eslint-disable-next-line security/detect-object-injection -- kind iterates a fixed exported list
      expect(['neutral', 'info', 'shift']).toContain(explain.NOISE_DECISION_TONE[kind]);
    }
  });

  it('words and tones a maintenance decision the same on the badge, the strip and the list', async () => {
    const explain = await import('@/lib/intelligence/incident-ux/explain');
    expect(explain.noiseBadgeKind('MAINTENANCE')).toBe(
      classifyAlertDecision('MAINTENANCE', 'SUPPRESS')
    );
    expect(explain.noiseBadgeLabel('MAINTENANCE', null)).toBe(
      explain.NOISE_DECISION_LABELS.maintenance
    );
    expect(explain.noiseBadgeLabel('MAINTENANCE', 'Deploy freeze')).toBe(
      'In maintenance: Deploy freeze'
    );
    expect(explain.NOISE_DECISION_TONE.maintenance).toBe('info');
    expect(explain.NOISE_DECISION_TONE.suppressed).toBe('neutral');
    expect(explain.NOISE_DECISION_TONE.grouped).toBe('shift');
  });
});
