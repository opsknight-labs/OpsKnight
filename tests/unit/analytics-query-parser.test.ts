import { describe, expect, it } from 'vitest';
import {
  analyticsHref,
  analyticsQuerySchema,
  parseAnalyticsQuery,
  toAnalyticsFilters,
} from '@/lib/intelligence/helpers/analytics-query';

const options = {
  teams: [{ id: 't1', name: 'Payments' }],
  services: [
    { id: 's1', name: 'Checkout' },
    { id: 's2', name: 'Checkout API' },
  ],
  users: [{ id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }],
};

describe('analytics natural-language filters (keyword path)', () => {
  it('maps a sentence to the filter object, longest service name first', () => {
    const query = parseAnalyticsQuery(
      'High urgency open incidents on checkout api for the last 2 weeks',
      options
    );
    expect(query).toEqual({
      team: null,
      service: 'Checkout API',
      assignee: null,
      status: 'OPEN',
      urgency: 'HIGH',
      windowDays: 14,
    });
    expect(analyticsQuerySchema.safeParse(query).success).toBe(true);
    expect(analyticsHref(toAnalyticsFilters(query, options))).toBe(
      '/insights?service=s2&status=OPEN&urgency=HIGH&window=14'
    );
  });

  it('reads team, assignee and single-unit windows, snapping to allowed windows', () => {
    const query = parseAnalyticsQuery('resolved by ada lovelace in payments this quarter', options);
    expect(toAnalyticsFilters(query, options)).toEqual({
      team: 't1',
      assignee: 'u1',
      status: 'RESOLVED',
      window: '90',
    });
    expect(toAnalyticsFilters(parseAnalyticsQuery('last 6 months', options), options)).toEqual({
      window: '180',
    });
  });

  it('drops names that are not readable options instead of guessing', () => {
    expect(
      toAnalyticsFilters(
        {
          team: 'Secret team',
          service: 'checkout',
          assignee: 'ADA@example.com',
          status: null,
          urgency: null,
          windowDays: null,
        },
        options
      )
    ).toEqual({ service: 's1', assignee: 'u1' });
    expect(analyticsHref({})).toBe('/insights');
  });

  it('rejects anything outside the filter object', () => {
    expect(
      analyticsQuerySchema.safeParse({
        team: null,
        service: null,
        assignee: null,
        status: 'DROP TABLE',
        urgency: null,
        windowDays: null,
      }).success
    ).toBe(false);
    expect(
      analyticsQuerySchema.safeParse({
        team: null,
        service: null,
        assignee: null,
        status: null,
        urgency: null,
        windowDays: null,
        sql: 'select 1',
      }).success
    ).toBe(false);
  });
});
