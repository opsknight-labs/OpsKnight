// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { diagnosticQuerySchema } from '@/lib/auth-control/diagnostic-contract';
import {
  diagnosticContext,
  encodeDiagnosticCursor,
  decodeDiagnosticCursor,
} from '@/lib/auth-control/diagnostic-cursor';
import {
  hasBroadAdministratorRule,
  providerDraftErrors,
  switchProviderDraft,
} from '@/lib/auth-control/provider-definitions';
import { providerConfigSchema } from '@/lib/auth-control/provider-config';
vi.mock('@/lib/secret-manager', () => ({
  getNextAuthSecret: async () => 'local-diagnostic-cursor-test-secret',
}));
const query = diagnosticQuerySchema.parse({ range: 'all' });
const context = diagnosticContext(query, 'admin:one', 2);
const payload = {
  v: 1 as const,
  context,
  snapshotAt: new Date().toISOString(),
  at: new Date().toISOString(),
  id: 'session-one',
};
describe('diagnostic security contract', () => {
  it('signs and restores a stable page boundary', async () => {
    const cursor = await encodeDiagnosticCursor(payload);
    expect(await decodeDiagnosticCursor(cursor, context)).toEqual(payload);
  });
  it('rejects tampering, a different actor, policy, filters and expired snapshots', async () => {
    const cursor = await encodeDiagnosticCursor(payload);
    await expect(decodeDiagnosticCursor(cursor + 'x', context)).rejects.toThrow();
    for (const changed of [
      diagnosticContext(query, 'admin:two', 2),
      diagnosticContext(query, 'admin:one', 3),
      diagnosticContext({ ...query, method: 'oidc' }, 'admin:one', 2),
    ])
      await expect(decodeDiagnosticCursor(cursor, changed)).rejects.toThrow();
    await expect(decodeDiagnosticCursor(cursor, context, Date.now() + 3600001)).rejects.toThrow();
  });
  it.each([0, 1, 24, 26, 101, 10000])('rejects unsupported page size %i', pageSize =>
    expect(diagnosticQuerySchema.safeParse({ pageSize }).success).toBe(false)
  );
  it('rejects unknown filters and reversed custom dates', () => {
    expect(diagnosticQuerySchema.safeParse({ secret: 'no' }).success).toBe(false);
    expect(
      diagnosticQuerySchema.safeParse({
        range: 'custom',
        from: '2026-10-15T00:00:00Z',
        to: '2026-10-14T00:00:00Z',
      }).success
    ).toBe(false);
  });
});
describe('provider draft safety', () => {
  const configuration = providerConfigSchema.parse({
    issuer: 'https://tenant.auth0.com',
    clientId: 'client',
    clientSecret: 'secret',
    providerType: 'auth0',
    organizationId: 'org_one',
    autoProvision: true,
    roleMapping: [{ claim: 'groups', value: 'admins', role: 'ADMIN' }],
    profileMapping: { department: 'dept' },
  });
  it.each(['azure', 'google', 'okta', 'auth0', 'custom'] as const)(
    'clears incompatible secrets and authorization claims when switching to %s',
    providerType => {
      const next = switchProviderDraft(configuration, providerType);
      expect(next).toMatchObject({
        providerType,
        clientId: '',
        clientSecret: '',
        organizationId: null,
        roleMapping: [],
        profileMapping: {},
        autoProvision: false,
      });
      expect(next.allowedDomains).toEqual(configuration.allowedDomains);
    }
  );
  it('requires explicit acknowledgment for broad administrator rules while allowing a dedicated group', () => {
    expect(hasBroadAdministratorRule([{ claim: 'groups', value: 'everyone', role: 'ADMIN' }])).toBe(
      true
    );
    expect(hasBroadAdministratorRule([{ claim: 'email', value: '*', role: 'ADMIN' }])).toBe(true);
    expect(
      hasBroadAdministratorRule([
        { claim: 'groups', value: 'opsknight-administrators', role: 'ADMIN' },
      ])
    ).toBe(false);
  });
  it('retains an existing secret only when the caller proves a matching source', () => {
    expect(providerDraftErrors({ ...configuration, clientSecret: '' }, true)).toEqual({});
    expect(providerDraftErrors({ ...configuration, clientSecret: '' }, false)).toHaveProperty(
      'clientSecret'
    );
  });
  it('validates Entra tenant and session relationships without assuming inherited defaults', () => {
    expect(
      providerDraftErrors(
        {
          ...configuration,
          providerType: 'azure',
          issuer: 'https://login.microsoftonline.com/common/v2.0',
        },
        true
      )
    ).toHaveProperty('issuer');
    expect(
      providerDraftErrors(
        { ...configuration, sessionMaxAgeSeconds: 3600, sessionIdleTimeoutSeconds: 7200 },
        true
      )
    ).toHaveProperty('sessionIdleTimeoutSeconds');
  });
});
