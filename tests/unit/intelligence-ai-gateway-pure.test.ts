import { describe, expect, it } from 'vitest';
import { ProviderBreakers } from '@/lib/intelligence/ai/breaker';
import { aiProviderInputSchema, aiSettingsInputSchema } from '@/lib/intelligence/ai/contract';
import { anyProviderAllows, selectProviderChain, type PolicyProvider } from '@/lib/intelligence/ai/policy';
import { redactSecrets } from '@/lib/intelligence/ai/redact';

const p = (id: string, overrides: Partial<PolicyProvider> = {}): PolicyProvider => ({
  id,
  enabled: true,
  isExternal: false,
  maxDataClass: 'INTERNAL',
  priority: 100,
  ...overrides,
});

describe('selectProviderChain', () => {
  it('orders by priority and excludes disabled providers and those whose ceiling is too low', () => {
    const chain = selectProviderChain(
      [p('c', { priority: 3 }), p('a', { priority: 1 }), p('off', { enabled: false, priority: 0 }), p('low', { maxDataClass: 'PUBLIC', priority: 2 }), p('b', { priority: 2 })],
      'INTERNAL',
      { allowExternalFallback: false }
    );
    expect(chain.map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks priority ties deterministically', () => {
    expect(selectProviderChain([p('b'), p('a')], 'PUBLIC', { allowExternalFallback: false }).map(x => x.id)).toEqual(['a', 'b']);
  });

  it('never lets a self-hosted primary fall back to an external provider without explicit consent', () => {
    const providers = [p('local', { priority: 1 }), p('cloud', { priority: 2, isExternal: true })];
    expect(selectProviderChain(providers, 'INTERNAL', { allowExternalFallback: false }).map(x => x.id)).toEqual(['local']);
    expect(selectProviderChain(providers, 'INTERNAL', { allowExternalFallback: true }).map(x => x.id)).toEqual(['local', 'cloud']);
  });

  it('allows external to back up external, and self-hosted to back up anything', () => {
    expect(
      selectProviderChain([p('c1', { priority: 1, isExternal: true }), p('c2', { priority: 2, isExternal: true }), p('l', { priority: 3 })], 'INTERNAL', { allowExternalFallback: false }).map(x => x.id)
    ).toEqual(['c1', 'c2', 'l']);
  });

  it('returns nothing when no provider may receive the data class', () => {
    expect(selectProviderChain([p('a', { maxDataClass: 'INTERNAL' })], 'SENSITIVE', { allowExternalFallback: true })).toEqual([]);
    expect(anyProviderAllows([p('a', { maxDataClass: 'INTERNAL' })], 'PERSONAL')).toBe(false);
    expect(anyProviderAllows([p('a', { maxDataClass: 'SENSITIVE' })], 'PERSONAL')).toBe(true);
  });
});

describe('redactSecrets', () => {
  it.each([
    ['password=hunter2hunter2'],
    ['api_key: abcdef123456'],
    ['Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'],
    ['sk-abcdefghijklmnopqrstuvwxyz1234'],
    ['AKIAABCDEFGHIJKLMNOP'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['xoxb-1234567890-abcdefghij'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
    ['postgres://admin:s3cretpass@db.internal:5432/app'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----'],
  ])('removes %s', input => {
    const out = redactSecrets(`before ${input} after`);
    expect(out).toContain('[redacted]');
    expect(out.startsWith('before ')).toBe(true);
    expect(out.endsWith(' after')).toBe(true);
    expect(out).not.toMatch(/hunter2|abcdef123456|abcdefghijklmnopqrstuvwxyz0|s3cretpass|MIIEabc/);
  });

  it('leaves ordinary operational text alone', () => {
    const text = 'api-3 latency high: p99 2300ms on checkout, token bucket empty, see https://example.com/runbook';
    expect(redactSecrets(text)).toBe(text);
  });

  it('stays fast on adversarial input', () => {
    const start = Date.now();
    redactSecrets('Bearer ' + 'a'.repeat(200_000) + ' ' + 'password='.repeat(20_000) + '-----BEGIN PRIVATE KEY-----' + 'x'.repeat(100_000));
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});

describe('ProviderBreakers', () => {
  it('opens after consecutive failures, admits one probe after the cool-down, and closes on success', () => {
    let now = 0;
    const breakers = new ProviderBreakers({ failureThreshold: 2, openMs: 1_000 }, () => now);
    expect(breakers.canAttempt('x')).toBe(true);
    breakers.recordFailure('x');
    expect(breakers.canAttempt('x')).toBe(true);
    breakers.recordFailure('x');
    expect(breakers.isOpen('x')).toBe(true);
    expect(breakers.canAttempt('x')).toBe(false);
    now = 1_001;
    expect(breakers.canAttempt('x')).toBe(true); // the probe
    expect(breakers.canAttempt('x')).toBe(false); // only one at a time
    breakers.recordFailure('x');
    expect(breakers.canAttempt('x')).toBe(false); // re-opened
    now = 2_100;
    expect(breakers.canAttempt('x')).toBe(true);
    breakers.recordSuccess('x');
    expect(breakers.canAttempt('x')).toBe(true);
    expect(breakers.isOpen('x')).toBe(false);
  });

  it('tracks providers independently', () => {
    const breakers = new ProviderBreakers({ failureThreshold: 1, openMs: 1_000 }, () => 0);
    breakers.recordFailure('a');
    expect(breakers.canAttempt('a')).toBe(false);
    expect(breakers.canAttempt('b')).toBe(true);
  });
});

describe('AI input schemas', () => {
  const settings = {
    enabled: true,
    squireEnabled: true,
    squireName: 'Squire',
    allowExternalFallback: false,
    requestsPerMinutePerUser: 20,
    dailyTokenBudget: 500_000,
    maxOutputTokens: 1_024,
    requestTimeoutMs: 30_000,
    expectedRevision: 0,
  };

  it('accepts friendly names and rejects markup or out-of-range values', () => {
    expect(aiSettingsInputSchema.safeParse(settings).success).toBe(true);
    for (const name of ['Pip', "O'Neil Bot", 'Scout 2', 'Sir Reginald-the-3rd']) {
      expect(aiSettingsInputSchema.safeParse({ ...settings, squireName: name }).success).toBe(true);
    }
    for (const name of ['<b>x</b>', 'a'.repeat(33), '', '   ', '"quoted"', 'a\nb']) {
      expect(aiSettingsInputSchema.safeParse({ ...settings, squireName: name }).success).toBe(false);
    }
    expect(aiSettingsInputSchema.safeParse({ ...settings, dailyTokenBudget: 10 }).success).toBe(false);
    expect(aiSettingsInputSchema.safeParse({ ...settings, extra: 1 }).success).toBe(false);
  });

  it('requires a URL for compatible endpoints and forbids private-network + external together', () => {
    const base = { name: 'x', kind: 'OPENAI_COMPATIBLE', model: 'm', enabled: true, isExternal: false, maxDataClass: 'INTERNAL', allowPrivateNetwork: false, priority: 1 };
    expect(aiProviderInputSchema.safeParse(base).success).toBe(false);
    expect(aiProviderInputSchema.safeParse({ ...base, baseUrl: 'https://x.example.com/v1' }).success).toBe(true);
    expect(aiProviderInputSchema.safeParse({ ...base, baseUrl: 'http://10.0.0.5/v1', allowPrivateNetwork: true, isExternal: true }).success).toBe(false);
    expect(aiProviderInputSchema.safeParse({ ...base, kind: 'OPENAI' }).success).toBe(true);
  });
});
