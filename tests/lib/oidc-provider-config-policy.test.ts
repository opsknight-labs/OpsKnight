import { describe, expect, it } from 'vitest';
import { providerConfigSchema } from '@/lib/auth-control/provider-config';

const base = {
  issuer: 'https://idp.example.com',
  clientId: 'client',
  clientSecret: 'secret',
};

describe('provider configuration role policy', () => {
  it('never accepts Administrator as the default role', () => {
    expect(providerConfigSchema.safeParse({ ...base, defaultRole: 'ADMIN' }).success).toBe(false);
    expect(providerConfigSchema.parse({ ...base, defaultRole: 'RESPONDER' }).defaultRole).toBe(
      'RESPONDER'
    );
    expect(providerConfigSchema.parse(base).defaultRole).toBe('USER');
  });

  it('accepts dotted claim paths and rejects empty or spaced segments', () => {
    const claim = (value: string) =>
      providerConfigSchema.safeParse({
        ...base,
        roleMapping: [{ claim: value, value: 'ops', role: 'USER' }],
      }).success;
    expect(claim('realm_access.roles')).toBe(true);
    expect(claim('https://opsknight/roles')).toBe(true);
    expect(claim('groups..x')).toBe(false);
    expect(claim('my groups')).toBe(false);
  });

  it('reports an empty or malformed issuer as a validation error instead of throwing', () => {
    for (const issuer of ['', 'not a url', 'https://', 'http://idp.example.com']) {
      const result = providerConfigSchema.safeParse({ ...base, issuer });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(i => i.path[0] === 'issuer')).toBe(true);
    }
  });
});
