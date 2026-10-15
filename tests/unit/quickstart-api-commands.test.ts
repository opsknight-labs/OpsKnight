import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getSample, POST as postSample } from '@/app/api/sample/route';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiKey: vi.fn().mockImplementation(async (req: NextRequest) => {
    const auth = req.headers.get('authorization') || '';
    const xKey = req.headers.get('x-api-key') || '';
    if (auth.includes('ok_live_test_key') || xKey === 'ok_live_test_key') {
      return {
        id: 'key_test_123',
        name: 'Test Quickstart Key',
        prefix: 'ok_live_test',
        scopes: ['events:write', 'incidents:read'],
        userId: 'usr_test_123',
      };
    }
    return null;
  }),
}));

describe('Quickstart Sample API Route (/api/sample)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles GET /api/sample with Bearer authentication', async () => {
    const req = new NextRequest('http://localhost:3000/api/sample', {
      headers: {
        Authorization: 'Bearer ok_live_test_key',
      },
    });

    const res = await getSample(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('success');
    expect(json.authenticated).toBe(true);
    expect(json.authMethod).toBe('Bearer');
    expect(json.key.name).toBe('Test Quickstart Key');
  });

  it('handles GET /api/sample with X-API-Key authentication', async () => {
    const req = new NextRequest('http://localhost:3000/api/sample', {
      headers: {
        'x-api-key': 'ok_live_test_key',
      },
    });

    const res = await getSample(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('success');
    expect(json.authenticated).toBe(true);
    expect(json.authMethod).toBe('X-API-Key');
    expect(json.key.scopes).toContain('events:write');
  });

  it('handles GET /api/sample when unauthenticated with helpful guidance', async () => {
    const req = new NextRequest('http://localhost:3000/api/sample');

    const res = await getSample(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('unauthenticated');
    expect(json.authenticated).toBe(false);
    expect(json.supportedHeaders).toContain('Authorization: Bearer <TOKEN>');
    expect(json.supportedHeaders).toContain('X-API-Key: <TOKEN>');
  });

  it('handles POST /api/sample and echoes back payload when authenticated', async () => {
    const req = new NextRequest('http://localhost:3000/api/sample', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ok_live_test_key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ping: true,
        source: 'quickstart-test-runner',
        testId: 'run-99',
      }),
    });

    const res = await postSample(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe('success');
    expect(json.authenticated).toBe(true);
    expect(json.echo).toEqual({
      ping: true,
      source: 'quickstart-test-runner',
      testId: 'run-99',
    });
  });

  it('rejects POST /api/sample with 401 when token is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/sample', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ping: true }),
    });

    const res = await postSample(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.status).toBe('unauthenticated');
    expect(json.authenticated).toBe(false);
  });
});
