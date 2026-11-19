import { describe, expect, it } from 'vitest';
import { ScheduleCreateV2Schema, ScheduleUpdateV2Schema } from '@/lib/api-v2/validation';

describe('v2 schedule timeZone validation', () => {
  it('rejects a non-IANA zone that would throw at paging time', () => {
    expect(
      ScheduleCreateV2Schema.safeParse({ name: 'Primary', timeZone: 'America/NewYork' }).success
    ).toBe(false);
    expect(ScheduleUpdateV2Schema.safeParse({ timeZone: 'Mars/Base' }).success).toBe(false);
  });

  it('accepts valid zones and defaults to UTC', () => {
    expect(ScheduleCreateV2Schema.parse({ name: 'Primary' }).timeZone).toBe('UTC');
    expect(ScheduleUpdateV2Schema.parse({ timeZone: ' America/New_York ' }).timeZone).toBe(
      'America/New_York'
    );
  });
});
