import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';

const { mockAssertCapability, mockEmitAuditEvent, mockExportPackage, mockPreviewPackage } =
  vi.hoisted(() => ({
    mockAssertCapability: vi.fn().mockResolvedValue({
      id: 'usr_auditor',
      email: 'auditor@opsknight.io',
      name: 'Auditor Lead',
      role: 'AUDITOR',
    }),
    mockEmitAuditEvent: vi.fn().mockResolvedValue(undefined),
    mockExportPackage: vi.fn().mockResolvedValue({
      packageId: 'pkg_test_123',
      filename: 'opsknight-evidence-package-deployment-2026-09-20.zip',
      zipBuffer: Buffer.from('PK\x03\x04mockzipcontent'),
      manifestResult: {
        manifestSha256: '9ac3400000000000000000000000000000000000000000000000000000000000',
      },
      counts: {
        controls: 10,
        requirements: 20,
        evidence: 50,
        integrityMismatches: 0,
      },
    }),
    mockPreviewPackage: vi.fn().mockResolvedValue({
      scope: { type: 'DEPLOYMENT' },
      evidenceSelection: { mode: 'SNAPSHOT' },
      snapshotAt: '2026-09-20T10:00:00.000Z',
      counts: { controls: 10, requirements: 20, evidence: 50 },
      estimatedSizeBytes: 45000,
    }),
  }));

vi.mock('@/lib/rbac', () => ({
  assertCapability: (...args: unknown[]) => mockAssertCapability(...args),
}));

vi.mock('@/lib/audit', () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));

vi.mock('@/lib/compliance/export', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/compliance/export')>();
  return {
    ...actual,
    exportComplianceEvidencePackage: (...args: unknown[]) => mockExportPackage(...args),
    previewComplianceEvidencePackage: (...args: unknown[]) => mockPreviewPackage(...args),
  };
});

import { POST as exportRoute } from '@/app/api/compliance/exports/route';
import { POST as previewRoute } from '@/app/api/compliance/exports/preview/route';

describe('/api/compliance/exports endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCapability.mockResolvedValue({
      id: 'usr_auditor',
      email: 'auditor@opsknight.io',
      name: 'Auditor Lead',
      role: 'AUDITOR',
    });
  });

  describe('POST /api/compliance/exports', () => {
    it('requires COMPLIANCE_EXPORT and COMPLIANCE_EVIDENCE_READ capabilities', async () => {
      mockAssertCapability.mockRejectedValueOnce(
        new AuthorizationError('COMPLIANCE_EXPORT required', CAPABILITIES.COMPLIANCE_EXPORT)
      );

      const req = new NextRequest('http://localhost/api/compliance/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: { type: 'DEPLOYMENT' },
          evidence: { mode: 'SNAPSHOT' },
        }),
      });

      const res = await exportRoute(req);
      expect(res.status).toBe(403);
    });

    it('returns application/zip attachment on successful export and emits audit logs', async () => {
      const req = new NextRequest('http://localhost/api/compliance/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: { type: 'DEPLOYMENT' },
          evidence: { mode: 'SNAPSHOT' },
        }),
      });

      const res = await exportRoute(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
      expect(res.headers.get('Content-Disposition')).toContain('attachment; filename=');

      // Verify audit events
      expect(mockEmitAuditEvent).toHaveBeenCalledTimes(2);
      expect(mockEmitAuditEvent.mock.calls[0][0].action).toBe('COMPLIANCE_EVIDENCE_EXPORT_STARTED');
      expect(mockEmitAuditEvent.mock.calls[1][0].action).toBe(
        'COMPLIANCE_EVIDENCE_EXPORT_COMPLETED'
      );
    });

    it('validates request schema and rejects invalid JSON or unknown options', async () => {
      const req = new NextRequest('http://localhost/api/compliance/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: { type: 'INVALID_SCOPE' },
          evidence: { mode: 'SNAPSHOT' },
        }),
      });

      const res = await exportRoute(req);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/compliance/exports/preview', () => {
    it('returns 200 with preview counts', async () => {
      const req = new NextRequest('http://localhost/api/compliance/exports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: { type: 'FRAMEWORK', framework: 'GDPR' },
          evidence: { mode: 'SNAPSHOT' },
        }),
      });

      const res = await previewRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.counts.controls).toBe(10);
      expect(json.data.counts.requirements).toBe(20);
    });
  });
});
