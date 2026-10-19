// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  evaluateOidcProof,
  OIDC_PROOF_MAX_AGE_MS,
  type OidcProofContext,
  type OidcProofRecord,
} from '@/lib/auth-control/proof-status';

const verifiedAt = new Date('2026-10-01T12:00:00.000Z');
const proof: OidcProofRecord = {
  verifiedAt,
  verifiedOrigin: 'https://ops.example.test',
  effectiveRole: 'ADMIN',
  testedConfigVersion: 4,
  adminUserId: 'admin-1',
  adminTokenVersion: 2,
};
const context = (overrides: Partial<OidcProofContext> = {}): OidcProofContext => ({
  now: new Date(verifiedAt.getTime() + 60_000),
  origin: 'https://ops.example.test',
  activeConfigVersion: 4,
  administrator: { role: 'ADMIN', status: 'ACTIVE', tokenVersion: 2 },
  ...overrides,
});

describe('administrator SSO proof policy (seven days)', () => {
  it('keeps the seven-day product policy as the activation lifetime', () => {
    expect(OIDC_PROOF_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('requires a test when no proof exists', () => {
    expect(evaluateOidcProof(null, context())).toEqual({
      state: 'required',
      verifiedAt: null,
      expiresAt: null,
      adminUserId: null,
    });
  });

  it('accepts a proof just before and exactly at the seven-day boundary', () => {
    const boundary = verifiedAt.getTime() + OIDC_PROOF_MAX_AGE_MS;
    expect(evaluateOidcProof(proof, context({ now: new Date(boundary - 1) })).state).toBe('valid');
    expect(evaluateOidcProof(proof, context({ now: new Date(boundary) })).state).toBe('valid');
  });

  it('rejects a proof one millisecond after seven days and reports the expiry time', () => {
    const boundary = verifiedAt.getTime() + OIDC_PROOF_MAX_AGE_MS;
    const status = evaluateOidcProof(proof, context({ now: new Date(boundary + 1) }));
    expect(status.state).toBe('expired');
    expect(status.expiresAt).toBe(new Date(boundary).toISOString());
  });

  it('invalidates a fresh proof when the active provider configuration changed', () => {
    expect(evaluateOidcProof(proof, context({ activeConfigVersion: 5 })).state).toBe(
      'config-changed'
    );
  });

  it.each([
    ['demoted', { role: 'USER', status: 'ACTIVE', tokenVersion: 2 }],
    ['disabled', { role: 'ADMIN', status: 'DISABLED', tokenVersion: 2 }],
    ['sessions revoked', { role: 'ADMIN', status: 'ACTIVE', tokenVersion: 3 }],
    ['removed', null],
  ])('requires the administrator to verify again when %s', (_label, administrator) => {
    expect(evaluateOidcProof(proof, context({ administrator })).state).toBe('admin-changed');
  });

  it('reports trust mismatch for another origin, a conflicting origin or a non-admin result', () => {
    expect(evaluateOidcProof(proof, context({ origin: 'https://other.example.test' })).state).toBe(
      'trust-mismatch'
    );
    expect(evaluateOidcProof(proof, context({ origin: null })).state).toBe('trust-mismatch');
    expect(evaluateOidcProof({ ...proof, effectiveRole: 'RESPONDER' }, context()).state).toBe(
      'trust-mismatch'
    );
  });

  it('is deterministic across replicas and restarts: it depends only on stored evidence', () => {
    const now = new Date(verifiedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    const first = evaluateOidcProof(proof, context({ now }));
    const second = evaluateOidcProof(structuredClone(proof), context({ now }));
    expect(second).toEqual(first);
  });
});
