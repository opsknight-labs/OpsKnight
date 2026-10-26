import { describe, expect, it } from 'vitest';
import { createDateTimeFormatterCache } from '@/lib/date-time-format';
describe('bounded immutable Intl formatter definitions', () => {
  it('keeps DST projection date-dependent while reusing a definition', () => {
    const get = createDateTimeFormatterCache('en-US', { hour: '2-digit', hourCycle: 'h23' });
    const formatter = get('America/New_York');
    expect(get('America/New_York')).toBe(formatter);
    expect(formatter.format(new Date('2026-03-08T06:30:00Z'))).toBe('01');
    expect(formatter.format(new Date('2026-03-08T07:30:00Z'))).toBe('03');
    expect(Object.isFrozen(formatter)).toBe(true);
  });
  it('evicts old definitions rather than retaining arbitrary zone cardinality', () => {
    const zones = Intl.supportedValuesOf('timeZone').slice(0, 65);
    const get = createDateTimeFormatterCache('en-US', { hour: 'numeric' });
    const first = get(zones[0]);
    for (const zone of zones.slice(1)) get(zone);
    expect(get(zones[0])).not.toBe(first);
  });
  it('does not cache invalid zone failures or mutate caller options', () => {
    const options: Intl.DateTimeFormatOptions = { hour: '2-digit', hourCycle: 'h23' };
    const get = createDateTimeFormatterCache('en-US', options);
    options.hourCycle = 'h12';
    expect(get('UTC').format(new Date('2026-01-01T23:00:00Z'))).toBe('23');
    expect(() => get('invalid-zone')).toThrow(RangeError);
  });
});
