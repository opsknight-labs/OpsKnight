import { describe, expect, it } from 'vitest';
import {
  isIpAllowed,
  isValidIpAllowEntry,
  normalizeIpAllowList,
} from '@/lib/status-pages/ip-allow-list';

describe('status page IP allow-list', () => {
  it('validates IPv4 and IPv6 entries and CIDR bounds', () => {
    for (const ok of ['10.0.0.1', '10.0.0.0/8', '2001:db8::/32', '::1', '::ffff:10.0.0.0/104'])
      expect(isValidIpAllowEntry(ok), ok).toBe(true);
    for (const bad of [
      '10.0.0.256',
      '10.0.0.0/33',
      '2001:db8::/129',
      'abc',
      '1.2.3',
      '1::2::3',
      '10.0.0.0/8/8',
      '',
    ])
      expect(isValidIpAllowEntry(bad), bad).toBe(false);
  });

  it('matches ranges and treats an empty list as unrestricted', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
    expect(isIpAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('192.168.1.5', ['192.168.1.5'])).toBe(true);
    expect(isIpAllowed('192.168.1.6', ['192.168.1.5'])).toBe(false);
    expect(isIpAllowed('2001:db8:1::9', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
  });

  it('maps IPv4-in-IPv6 clients and never crosses families', () => {
    expect(isIpAllowed('::ffff:10.1.1.1', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('10.1.1.1', ['2001:db8::/32'])).toBe(false);
  });

  it('fails closed when the client cannot be identified', () => {
    expect(isIpAllowed(undefined, ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('not-an-ip', ['10.0.0.0/8'])).toBe(false);
  });

  it('normalizes by trimming and de-duplicating', () => {
    expect(normalizeIpAllowList([' 10.0.0.0/8', '10.0.0.0/8', ''])).toEqual(['10.0.0.0/8']);
  });
});
