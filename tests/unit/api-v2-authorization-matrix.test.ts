/* eslint-disable security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name */
import { describe, expect, it } from 'vitest';
import { implementedOperations } from '../helpers/v2-route-inventory';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { API_SCOPES, type ApiScope } from '@/lib/authorization';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';

const ROLES = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as const;

function actor(
  role: (typeof ROLES)[number],
  scopes: readonly string[] | null,
  status: 'ACTIVE' | 'DISABLED' = 'ACTIVE'
): AuthorizationActor {
  return {
    id: `usr_${role.toLowerCase()}`,
    role,
    status,
    teamIds: ['team_a'],
    ...(scopes ? { apiKey: { id: 'key_1', scopes: [...scopes] } } : {}),
  } as AuthorizationActor;
}

const operations = implementedOperations().map(route => ({
  ...route,
  scope: V2_OPERATIONS.find(o => o.method === route.method && o.path === route.path)!.scope,
  action: (AUTHORIZATION_ACTIONS as Record<string, string>)[route.action],
}));

describe('REST v2 authorization matrix', () => {
  it('covers every implemented operation', () => {
    expect(operations.length).toBe(V2_OPERATIONS.length);
    for (const op of operations) expect(op.action, `${op.method} ${op.path}`).toBeDefined();
  });

  it('denies every operation to a credential that lacks the required scope, for every role', () => {
    for (const op of operations) {
      for (const role of ROLES) {
        const decision = authorize({
          actor: actor(role, [API_SCOPES.EVENTS_WRITE]),
          action: op.action as never,
        });
        expect(decision.allowed, `${role} ${op.method} ${op.path} without ${op.scope}`).toBe(false);
      }
    }
  });

  it('denies every operation to a disabled principal even with the right scope', () => {
    for (const op of operations) {
      for (const role of ROLES) {
        const decision = authorize({
          actor: actor(role, [op.scope], 'DISABLED'),
          action: op.action as never,
        });
        expect(decision.allowed, `${role} ${op.method} ${op.path}`).toBe(false);
      }
    }
  });

  it('never lets a USER-role credential mutate organization resources', () => {
    for (const op of operations.filter(
      o => o.method !== 'get' && !o.path.startsWith('/users/me/notification-preferences')
    )) {
      const decision = authorize({
        actor: actor('USER', [op.scope, API_SCOPES.ADMIN_MANAGE]),
        action: op.action as never,
      });
      // Incident operations may be scoped; preference operations are self-only by route construction.
      if (decision.allowed) expect(decision.scope, `${op.method} ${op.path}`).toBe('resource');
    }
  });

  it('never lets a non-ADMIN role administer service accounts', () => {
    for (const op of operations.filter(o => o.path.startsWith('/service-accounts'))) {
      for (const role of ['RESPONDER', 'AUDITOR', 'USER'] as const) {
        const decision = authorize({
          actor: actor(role, [op.scope, API_SCOPES.ADMIN_MANAGE]),
          action: op.action as never,
        });
        expect(decision.allowed, `${role} ${op.method} ${op.path}`).toBe(false);
      }
    }
  });

  it('records primary authorization actions so policy changes are reviewed', async () => {
    // Composite requirements (for example automation decisions also require
    // incidents:read) are exercised against the actual routes in PostgreSQL tests.
    const matrix: Record<string, Record<string, string>> = {};
    for (const op of operations) {
      const row: Record<string, string> = {};
      for (const role of ROLES) {
        const decision = authorize({ actor: actor(role, [op.scope]), action: op.action as never });
        row[role] = decision.allowed ? `allow:${decision.scope}` : `deny:${decision.reason}`;
      }
      matrix[`${op.method.toUpperCase()} ${op.path} [${op.scope}]`] = row;
    }
    await expect(JSON.stringify(matrix, null, 2) + '\n').toMatchFileSnapshot(
      '../fixtures/api-v2-authorization-matrix.json'
    );
  });

  it('keeps the scope registry and the policy table aligned', () => {
    const scopes = new Set<string>(Object.values(API_SCOPES));
    for (const op of operations) expect(scopes.has(op.scope as ApiScope)).toBe(true);
  });
});
