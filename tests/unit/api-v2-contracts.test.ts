import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  }),
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn().mockImplementation(async fn => fn({})),
}));

vi.mock('@/lib/idempotency', () => ({
  executeIdempotentOperation: vi.fn().mockImplementation(async (_tx, opts) => ({
    value: await opts.execute(),
    replayed: false,
  })),
}));

import {
  enforceV2Authorization,
  hasV2Scope,
  enforceV2RateLimit,
  runV2IdempotentMutation,
  idempotencyResponseHeaders,
  hashTokenV2,
  generateServiceAccountTokenRaw,
  RATE_LIMIT_CONFIGS,
  IncidentCreateV2Schema,
  ServiceCreateV2Schema,
  PostmortemCreateV2Schema,
  ServiceAccountCreateV2Schema,
  ServiceAccountTokenIssueV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import { API_SCOPES } from '@/lib/authorization';
import { AppError } from '@/lib/errors';
import { GET as getOpenApiRoute } from '@/app/api/v2/openapi.json/route';

describe('API v2 Contracts & Security', () => {
  describe('RBAC & Scope Enforcement', () => {
    const adminActor: AuthorizationActor = {
      id: 'usr_admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamIds: ['team_1'],
      apiKey: { id: 'key_admin', scopes: [API_SCOPES.ADMIN_MANAGE] },
    };

    const responderActor: AuthorizationActor = {
      id: 'usr_resp',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: ['team_1'],
      apiKey: { id: 'key_resp', scopes: [API_SCOPES.INCIDENTS_READ, API_SCOPES.INCIDENTS_WRITE] },
    };

    const viewerActor: AuthorizationActor = {
      id: 'usr_view',
      role: 'USER',
      status: 'ACTIVE',
      teamIds: ['team_1'],
      apiKey: { id: 'key_view', scopes: [API_SCOPES.INCIDENTS_READ] },
    };

    it('allows admin actor with admin:manage scope for any action', () => {
      expect(() => enforceV2Authorization(adminActor, AUTHORIZATION_ACTIONS.INCIDENT_CREATE)).not.toThrow();
      expect(() => enforceV2Authorization(adminActor, AUTHORIZATION_ACTIONS.SERVICE_CREATE)).not.toThrow();
      expect(() => enforceV2Authorization(adminActor, AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE)).not.toThrow();
    });

    it('allows responder with incidents:write to create incidents', () => {
      expect(() => enforceV2Authorization(responderActor, AUTHORIZATION_ACTIONS.INCIDENT_CREATE)).not.toThrow();
    });

    it('rejects viewer attempting write action with AppError 403', () => {
      expect(() => enforceV2Authorization(viewerActor, AUTHORIZATION_ACTIONS.INCIDENT_CREATE)).toThrow(AppError);
      try {
        enforceV2Authorization(viewerActor, AUTHORIZATION_ACTIONS.INCIDENT_CREATE);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(403);
      }
    });

    it('validates hasV2Scope correctly', () => {
      expect(hasV2Scope(responderActor, API_SCOPES.INCIDENTS_READ)).toBe(true);
      expect(hasV2Scope(responderActor, API_SCOPES.SERVICES_WRITE)).toBe(false);
      expect(hasV2Scope(adminActor, API_SCOPES.SERVICES_WRITE)).toBe(true);
    });
  });

  describe('Rate Limiting & Tier Headers', () => {
    it('returns rate limit headers with memory-shield fast path', async () => {
      const apiKeyId = `key_test_${Date.now()}`;
      const headers = await enforceV2RateLimit(apiKeyId, 'READ');

      expect(headers['X-RateLimit-Limit']).toBe(String(RATE_LIMIT_CONFIGS.READ.limit));
      expect(Number(headers['X-RateLimit-Remaining'])).toBeLessThanOrEqual(RATE_LIMIT_CONFIGS.READ.limit);
      expect(headers['X-RateLimit-Reset']).toBeTruthy();
    });
  });

  describe('Idempotency Execution', () => {
    it('executes mutation and formats headers correctly', async () => {
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        method: 'POST',
        headers: { 'idempotency-key': 'idem-test-123' },
      });

      const spy = vi.fn().mockResolvedValue({ id: 'inc_new' });
      const execution = await runV2IdempotentMutation(req, 'key_123', 'incidents:create', { title: 'Test' }, spy);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(execution.value).toEqual({ id: 'inc_new' });

      const replayedHeaders = idempotencyResponseHeaders(true);
      expect(replayedHeaders['Idempotency-Replayed']).toBe('true');

      const normalHeaders = idempotencyResponseHeaders(false);
      expect(normalHeaders['Idempotency-Replayed']).toBeUndefined();
    });
  });

  describe('Service Account Token Utilities', () => {
    it('generates properly formatted tokens with prefix', () => {
      const { token, prefix, tokenHash } = generateServiceAccountTokenRaw();
      expect(token.startsWith('ok_sa_')).toBe(true);
      expect(tokenHash).toHaveLength(64);
      expect(prefix.length).toBeGreaterThan(5);
    });

    it('hashes tokens deterministically with HMAC SHA-256', () => {
      const token = 'ok_sa_test_sampletoken1234567890';
      const hash1 = hashTokenV2(token);
      const hash2 = hashTokenV2(token);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe('Resource Validation Schemas', () => {
    it('validates Incident creation schema', () => {
      const valid = IncidentCreateV2Schema.parse({
        title: 'High latency on API gateway',
        priority: 'P1',
        serviceId: 'svc_123',
      });
      expect(valid.title).toBe('High latency on API gateway');
      expect(valid.priority).toBe('P1');

      expect(() => IncidentCreateV2Schema.parse({ title: 'A' })).toThrow();
    });

    it('validates Service creation schema', () => {
      const valid = ServiceCreateV2Schema.parse({
        name: 'Billing Engine',
        teamId: 'team_core',
        escalationPolicyId: 'ep_123',
      });
      expect(valid.name).toBe('Billing Engine');

      expect(() => ServiceCreateV2Schema.parse({ name: 'B', teamId: '' })).toThrow();
    });

    it('validates Postmortem creation schema', () => {
      const valid = PostmortemCreateV2Schema.parse({
        incidentId: 'inc_123',
        summary: 'Root cause analysis of checkout drop',
        rootCause: 'Database connection pool exhaustion',
        status: 'DRAFT',
      });
      expect(valid.incidentId).toBe('inc_123');
      expect(valid.status).toBe('DRAFT');

      expect(() => PostmortemCreateV2Schema.parse({ incidentId: 'inc_123', summary: 'Too' })).toThrow();
    });

    it('validates Service Account creation and token issuance schemas', () => {
      const sa = ServiceAccountCreateV2Schema.parse({
        name: 'Terraform Automation',
        role: 'ADMIN',
      });
      expect(sa.name).toBe('Terraform Automation');

      const tokenIssue = ServiceAccountTokenIssueV2Schema.parse({
        name: 'CI/CD Deploy Key',
        scopes: ['incidents:read', 'services:write'],
        expiresInDays: 90,
      });
      expect(tokenIssue.scopes).toContain('services:write');
    });
  });

  describe('OpenAPI Route Endpoint', () => {
    it('returns the bare OpenAPI 3.1 document at /api/v2/openapi.json', async () => {
      const req = new NextRequest('http://localhost:3000/api/v2/openapi.json');
      const response = await getOpenApiRoute(req);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const body = await response.json();
      // Standard consumers read these at the root, not under an envelope.
      expect(body.data).toBeUndefined();
      expect(body.requestId).toBeUndefined();
      expect(body.openapi).toBe('3.1.0');
      expect(body.info.title).toContain('OpsKnight');
      expect(body.paths['/incidents']).toBeDefined();
      expect(body.paths['/services']).toBeDefined();
      expect(body.paths['/postmortems']).toBeDefined();
      expect(body.paths['/service-accounts']).toBeDefined();
    });
  });
});
