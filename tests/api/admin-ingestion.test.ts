import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/ingestion/route';
import { getUserPermissions } from '@/lib/rbac';
import { applyIngestionCommand, ingestionSnapshot } from '@/lib/ingestion/operations';

vi.mock('@/lib/rbac', () => ({ getUserPermissions: vi.fn() }));
vi.mock('@/lib/ingestion/operations', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/ingestion/operations')>()),
  applyIngestionCommand: vi.fn(),
  ingestionSnapshot: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserPermissions).mockResolvedValue({
    id: 'admin',
    authenticated: true,
    role: 'ADMIN',
    capabilities: ['admin.manage'],
    isAdmin: true,
    isAuditor: false,
    isAdminOrResponder: true,
    isResponderOrAbove: true,
  });
});
const request = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/ingestion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('ingestion operator authorization', () => {
  it('denies unauthenticated inspection and mutation before touching ingestion state', async () => {
    vi.mocked(getUserPermissions).mockResolvedValue({
      id: '',
      authenticated: false,
      role: 'VIEWER',
      capabilities: [],
      isAdmin: false,
      isAuditor: false,
      isAdminOrResponder: false,
      isResponderOrAbove: false,
    });
    expect((await GET(new NextRequest('http://localhost/api/admin/ingestion'))).status).toBe(401);
    expect((await POST(request({ action: 'pause' }))).status).toBe(401);
    expect(ingestionSnapshot).not.toHaveBeenCalled();
    expect(applyIngestionCommand).not.toHaveBeenCalled();
  });
  it('requires admin.manage for receipt inspection and replay', async () => {
    vi.mocked(getUserPermissions).mockResolvedValue({
      id: 'responder',
      authenticated: true,
      role: 'RESPONDER',
      capabilities: [],
      isAdmin: false,
      isAuditor: false,
      isAdminOrResponder: true,
      isResponderOrAbove: true,
    });
    expect((await GET(new NextRequest('http://localhost/api/admin/ingestion'))).status).toBe(403);
    expect((await POST(request({ action: 'pause' }))).status).toBe(403);
    expect(applyIngestionCommand).not.toHaveBeenCalled();
  });
  it('rejects unrecognized commands and does not expose payload-edit or delete operations', async () => {
    for (const body of [
      { action: 'discard' },
      { action: 'replay', receiptId: 'invalid' },
      { action: 'pause', discard: true },
      {
        action: 'archive',
        receiptId: '4c0dd9de-e55d-4753-b514-95fedbbfd64f',
        reason: 'Minimize dead letter',
      },
      {
        action: 'archive',
        receiptId: '4c0dd9de-e55d-4753-b514-95fedbbfd64f',
        reason: 'Minimize dead letter',
        confirmDiscardAcceptedEvent: false,
      },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(applyIngestionCommand).not.toHaveBeenCalled();
  });
  it('requires explicit discard acknowledgement and passes the archive reason to the audited operation', async () => {
    const command = {
      action: 'archive' as const,
      receiptId: '4c0dd9de-e55d-4753-b514-95fedbbfd64f',
      reason: 'Minimize orphaned provider data',
      confirmDiscardAcceptedEvent: true as const,
    };
    vi.mocked(applyIngestionCommand).mockResolvedValue({ action: 'archive' });
    expect((await POST(request(command))).status).toBe(200);
    expect(applyIngestionCommand).toHaveBeenCalledWith(command, 'admin');
  });
  it('passes the authenticated actor into the transactional audit operation', async () => {
    vi.mocked(applyIngestionCommand).mockResolvedValue({ action: 'pause' });
    expect((await POST(request({ action: 'pause' }))).status).toBe(200);
    expect(applyIngestionCommand).toHaveBeenCalledWith({ action: 'pause' }, 'admin');
  });
});
