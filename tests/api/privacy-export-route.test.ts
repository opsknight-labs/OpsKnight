import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  createExportArtifact: vi.fn(),
  downloadExportArtifact: vi.fn(),
  artifactFindUnique: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ assertCapability: mocks.assertCapability }));
vi.mock('@/lib/privacy/export/artifact', () => ({
  createExportArtifact: mocks.createExportArtifact,
  downloadExportArtifact: mocks.downloadExportArtifact,
}));
vi.mock('@/lib/prisma', () => ({
  default: { privacyExportArtifact: { findUnique: mocks.artifactFindUnique } },
}));

import { AuthorizationError } from '@/lib/authorization';
import { POST as generateExport } from '@/app/api/compliance/privacy-requests/[id]/export/route';
import { GET as downloadExport } from '@/app/api/compliance/privacy-requests/[id]/export/[artifactId]/download/route';

const REQUEST_ID = 'creq00000001';
const ARTIFACT_ID = 'cartifact0001';

describe('privacy export API authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generate export returns 403 without privacy.export', async () => {
    mocks.assertCapability.mockRejectedValue(
      new AuthorizationError(
        'Unauthorized. Missing required capability: privacy.export.',
        'privacy.export'
      )
    );

    const response = await generateExport(new Request('https://example.com', { method: 'POST' }), {
      params: Promise.resolve({ id: REQUEST_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createExportArtifact).not.toHaveBeenCalled();
  });

  it('generate export succeeds and returns the artifact for an authorized caller', async () => {
    mocks.assertCapability.mockResolvedValue({ id: 'cactor0000001' });
    mocks.createExportArtifact.mockResolvedValue({ id: 'cartifact0001', status: 'READY' });

    const response = await generateExport(new Request('https://example.com', { method: 'POST' }), {
      params: Promise.resolve({ id: REQUEST_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.artifact.id).toBe('cartifact0001');
    expect(mocks.createExportArtifact).toHaveBeenCalledWith(REQUEST_ID, { id: 'cactor0000001' });
  });

  it('download returns 403 without privacy.export, before touching the artifact store', async () => {
    mocks.assertCapability.mockRejectedValue(
      new AuthorizationError(
        'Unauthorized. Missing required capability: privacy.export.',
        'privacy.export'
      )
    );

    const response = await downloadExport(new Request('https://example.com'), {
      params: Promise.resolve({ id: REQUEST_ID, artifactId: ARTIFACT_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.artifactFindUnique).not.toHaveBeenCalled();
    expect(mocks.downloadExportArtifact).not.toHaveBeenCalled();
  });

  it("download returns not-found when the artifact doesn't belong to the request in the URL", async () => {
    mocks.assertCapability.mockResolvedValue({ id: 'cactor0000001' });
    mocks.artifactFindUnique.mockResolvedValue({ requestId: 'some-other-request' });

    const response = await downloadExport(new Request('https://example.com'), {
      params: Promise.resolve({ id: REQUEST_ID, artifactId: ARTIFACT_ID }),
    });

    expect(response.status).toBe(404);
    expect(mocks.downloadExportArtifact).not.toHaveBeenCalled();
  });

  it('download streams the zip with no-store headers for an authorized, matching artifact', async () => {
    mocks.assertCapability.mockResolvedValue({ id: 'cactor0000001' });
    mocks.artifactFindUnique.mockResolvedValue({ requestId: REQUEST_ID });
    mocks.downloadExportArtifact.mockResolvedValue({
      buffer: Buffer.from('zip-bytes'),
      checksum: 'abc',
      requestId: REQUEST_ID,
    });

    const response = await downloadExport(new Request('https://example.com'), {
      params: Promise.resolve({ id: REQUEST_ID, artifactId: ARTIFACT_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toContain(REQUEST_ID);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString()).toBe('zip-bytes');
  });
});
