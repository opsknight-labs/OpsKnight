import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  createPrivacyRequest: vi.fn(),
  listPrivacyRequests: vi.fn(),
  transitionPrivacyRequest: vi.fn(),
  assignPrivacyRequest: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: mocks.assertCapability,
}));

vi.mock('@/lib/privacy/requests', () => ({
  createPrivacyRequest: mocks.createPrivacyRequest,
  listPrivacyRequests: mocks.listPrivacyRequests,
  transitionPrivacyRequest: mocks.transitionPrivacyRequest,
  assignPrivacyRequest: mocks.assignPrivacyRequest,
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/compliance/privacy-requests/route';
import { POST as transitionRoute } from '@/app/api/compliance/privacy-requests/[id]/transition/route';
import { AuthorizationError } from '@/lib/authorization';

function makeRequest(url: string, init?: RequestInit) {
  return new NextRequest(new Request(url, init));
}

describe('privacy requests API authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 403 when the caller lacks privacy.read', async () => {
    mocks.assertCapability.mockRejectedValue(
      new AuthorizationError(
        'Unauthorized. Missing required capability: privacy.read.',
        'privacy.read'
      )
    );

    const response = await GET(makeRequest('https://example.com/api/compliance/privacy-requests'));

    expect(response.status).toBe(403);
    expect(mocks.listPrivacyRequests).not.toHaveBeenCalled();
  });

  it('GET returns the request list when the caller has privacy.read', async () => {
    mocks.assertCapability.mockResolvedValue({ id: 'cactor0000001' });
    mocks.listPrivacyRequests.mockResolvedValue([{ id: 'creq00000001', status: 'RECEIVED' }]);

    const response = await GET(makeRequest('https://example.com/api/compliance/privacy-requests'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.requests).toHaveLength(1);
  });

  it('POST returns 403 when the caller lacks privacy.requests.manage (read-only auditor)', async () => {
    mocks.assertCapability.mockRejectedValue(
      new AuthorizationError(
        'Unauthorized. Missing required capability: privacy.requests.manage.',
        'privacy.requests.manage'
      )
    );

    const response = await POST(
      makeRequest('https://example.com/api/compliance/privacy-requests', {
        method: 'POST',
        body: JSON.stringify({ subjectId: 'user-1', requestType: 'ACCESS' }),
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.createPrivacyRequest).not.toHaveBeenCalled();
  });

  it('POST creates a request when the caller has privacy.requests.manage', async () => {
    mocks.assertCapability.mockResolvedValue({ id: 'cactor0000001' });
    mocks.createPrivacyRequest.mockResolvedValue({ id: 'creq00000001', status: 'RECEIVED' });

    const response = await POST(
      makeRequest('https://example.com/api/compliance/privacy-requests', {
        method: 'POST',
        body: JSON.stringify({ subjectId: 'user-1', requestType: 'ACCESS' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.request.id).toBe('creq00000001');
    expect(mocks.createPrivacyRequest).toHaveBeenCalledWith(
      { subjectId: 'user-1', requestType: 'ACCESS' },
      { id: 'cactor0000001' }
    );
  });

  it('transition route rejects a non-manager with 403 before touching the lib layer', async () => {
    mocks.assertCapability.mockRejectedValue(
      new AuthorizationError(
        'Unauthorized. Missing required capability: privacy.requests.manage.',
        'privacy.requests.manage'
      )
    );

    const response = await transitionRoute(
      makeRequest('https://example.com/api/compliance/privacy-requests/creq00000001/transition', {
        method: 'POST',
        body: JSON.stringify({ toStatus: 'IN_REVIEW' }),
      }),
      { params: Promise.resolve({ id: 'creq00000001' }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.transitionPrivacyRequest).not.toHaveBeenCalled();
  });
});
