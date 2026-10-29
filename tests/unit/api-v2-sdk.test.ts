import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, ApiError } from '../../sdk/typescript/client';
import { OPERATIONS, type OperationRequests } from '../../sdk/typescript/schema';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';

const fetcher = vi.fn<typeof fetch>();
const client = () =>
  new Client({
    baseUrl: 'https://ops.example/api/v2',
    token: 'private-test-token',
    fetch: fetcher,
  });
const response = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });
beforeEach(() => vi.clearAllMocks());

describe('generated TypeScript client', () => {
  it('has a manifest entry for every implemented operation', () => {
    expect(Object.keys(OPERATIONS).sort()).toEqual(
      V2_OPERATIONS.map(operation => operation.operationId).sort()
    );
  });
  it('sends credentials only in headers and encodes every path parameter', async () => {
    fetcher.mockResolvedValue(response({ data: { id: 'incident' } }));
    await client().call('getIncident', { params: { id: 'a/b?c#d' } });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://ops.example/api/v2/incidents/a%2Fb%3Fc%23d');
    expect(String(url)).not.toContain('private-test-token');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer private-test-token');
    expect(options?.redirect).toBe('error');
  });
  it('rejects unsafe API roots and missing required inputs before a request', async () => {
    for (const baseUrl of [
      'http://ops.example/api/v2',
      'https://user:pass@ops.example/api/v2',
      'https://ops.example/api/v2?token=secret',
    ]) {
      expect(() => new Client({ baseUrl, token: 'token' })).toThrow();
    }
    await expect(client().call('getIncident', { params: { id: '..' } })).rejects.toThrow(
      'path parameter'
    );
    await expect(
      client().call('publishRunbookDraft', {
        params: { id: 'runbook', versionId: 'version' },
        body: {},
        headers: {},
      } as OperationRequests['publishRunbookDraft'])
    ).rejects.toThrow('Required header');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not permit authorization overrides through arbitrary headers', async () => {
    await expect(
      client().call('listIncidents', {
        headers: { Authorization: 'another-token' },
      } as OperationRequests['listIncidents'])
    ).rejects.toThrow('custom headers');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retries an idempotent write with identical body and key', async () => {
    fetcher
      .mockResolvedValueOnce(response({ code: 'TEMPORARY' }, 503, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(response({ data: { executionId: 'one' } }, 202));
    await client().call('executeRunbook', {
      params: { id: 'runbook' },
      body: {},
      headers: { 'Idempotency-Key': 'one-command' },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    for (const [, options] of fetcher.mock.calls)
      expect(new Headers(options?.headers).get('idempotency-key')).toBe('one-command');
  });
  it('never retries token issuance, or a write without an idempotency key', async () => {
    fetcher.mockResolvedValue(response({ code: 'TEMPORARY' }, 503, { 'Retry-After': '0' }));
    await expect(
      client().call('issueServiceAccountToken', {
        params: { id: 'account' },
        body: { name: 'ci', scopes: ['incidents:read'], expiresInDays: 1 },
      })
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear();
    await expect(
      client().call('createIncident', { body: { title: 'Alert', serviceId: 'service' } })
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('preserves HTTP precondition errors and request correlation without raw sensitive errors', async () => {
    fetcher.mockResolvedValue(
      response({ code: 'PRECONDITION_FAILED', detail: 'SECRET_ERROR_MARKER' }, 412, {
        'x-request-id': 'req-one',
      })
    );
    await expect(
      client().call('updateRunbookDraft', {
        params: { id: 'runbook', versionId: 'version' },
        headers: { 'If-Match': '"3"', 'Idempotency-Key': 'edit' },
        body: { definition: { steps: [] } },
      })
    ).rejects.toMatchObject({ status: 412, code: 'PRECONDITION_FAILED', requestId: 'req-one' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('honors long Retry-After by returning the failure instead of retrying early', async () => {
    fetcher.mockResolvedValue(response({ code: 'RATE_LIMITED' }, 429, { 'Retry-After': '3600' }));
    await expect(client().call('listIncidents', {})).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('traverses cursors without changing caller input', async () => {
    fetcher
      .mockResolvedValueOnce(
        response({
          data: [{ id: 'one' }],
          pagination: { hasMore: true, nextCursor: 'signed-cursor' },
        })
      )
      .mockResolvedValueOnce(
        response({ data: [{ id: 'two' }], pagination: { hasMore: false, nextCursor: null } })
      );
    const request = { query: { limit: 1 } };
    const rows: unknown[] = [];
    for await (const row of client().paginate('listIncidents', request)) rows.push(row);
    expect(rows).toEqual([{ id: 'one' }, { id: 'two' }]);
    expect(String(fetcher.mock.calls[1][0])).toContain('cursor=signed-cursor');
    expect(request).toEqual({ query: { limit: 1 } });
  });
  it('bounds pagination when the server repeats a cursor', async () => {
    fetcher.mockImplementation(async () =>
      response({ data: [], pagination: { hasMore: true, nextCursor: 'repeat' } })
    );
    const iterate = async () => {
      for await (const row of client().paginate('listIncidents', {})) void row;
    };
    await expect(iterate()).rejects.toThrow('repeated pagination cursor');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not expose malformed success payloads in parser errors', async () => {
    fetcher.mockResolvedValue(new Response('PRIVATE_RESPONSE_MARKER', { status: 200 }));
    await expect(client().call('listIncidents', {})).rejects.toThrow('API returned invalid JSON.');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('returns bounded export bytes without parsing the downloaded JSON file as an API envelope', async () => {
    const bytes = new TextEncoder().encode('{"metrics":{"totalIncidents":1}}');
    fetcher.mockResolvedValue(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    const result = await client().call('downloadReportExport', { params: { id: 'report' } });
    expect(Array.from(result)).toEqual(Array.from(bytes));
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer private-test-token');
  });
  it('does not retry transport uncertainty for executable writes', async () => {
    fetcher.mockRejectedValue(new TypeError('network disconnected'));
    await expect(
      client().call('executeRunbook', {
        params: { id: 'runbook' },
        body: {},
        headers: { 'Idempotency-Key': 'one-command' },
      })
    ).rejects.toThrow('network disconnected');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
