import { describe, it, expect } from 'vitest';
import {
  createApiResponseContext,
  jsonApiError,
  jsonApiOk,
  jsonOk,
  jsonError,
} from '@/lib/api-response';
import { AppError, ERROR_REGISTRY } from '@/lib/errors';

describe('API Response Utilities', () => {
  describe('canonical contract', () => {
    it('creates stable request metadata from a trusted incoming request id', () => {
      const context = createApiResponseContext(
        new Request('https://opsknight.test/api/test', {
          headers: { 'x-request-id': 'request-123' },
        }),
        new Date('2026-08-28T10:00:00.000Z')
      );

      expect(context).toEqual({
        requestId: 'request-123',
        timestamp: '2026-08-28T10:00:00.000Z',
      });
    });

    it('rejects untrusted incoming request ids', () => {
      const context = createApiResponseContext(
        new Request('https://opsknight.test/api/test', {
          headers: { 'x-request-id': 'invalid request id' },
        })
      );

      expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns the canonical success envelope with pagination and warnings', async () => {
      const context = {
        requestId: 'request-success',
        timestamp: '2026-08-28T10:00:00.000Z',
      };
      const response = jsonApiOk(
        { incidents: [{ id: 'incident-1' }] },
        {
          context,
          dataState: 'partial',
          pagination: {
            mode: 'offset',
            page: 2,
            pageSize: 25,
            totalItems: 60,
            totalPages: 3,
          },
          warnings: [{ code: 'RETENTION_CLIPPED', message: 'Older records were excluded.' }],
        }
      );

      await expect(response.json()).resolves.toEqual({
        success: true,
        data: { incidents: [{ id: 'incident-1' }] },
        dataState: 'partial',
        requestId: 'request-success',
        timestamp: '2026-08-28T10:00:00.000Z',
        pagination: {
          mode: 'offset',
          page: 2,
          pageSize: 25,
          totalItems: 60,
          totalPages: 3,
        },
        warnings: [{ code: 'RETENTION_CLIPPED', message: 'Older records were excluded.' }],
      });
      expect(response.headers.get('x-request-id')).toBe('request-success');
    });

    it('uses no_data for a null success payload', async () => {
      const response = jsonApiOk(null, {
        context: { requestId: 'request-empty', timestamp: '2026-08-28T10:00:00.000Z' },
      });

      const body = await response.json();
      expect(body.dataState).toBe('no_data');
      expect(body.data).toBeNull();
    });

    it('returns a safe canonical typed error with matching correlation metadata', async () => {
      const response = jsonApiError(new Error('database-password'), {
        context: { requestId: 'request-error', timestamp: '2026-08-28T10:00:00.000Z' },
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(response.headers.get('x-request-id')).toBe('request-error');
      expect(body).toMatchObject({
        success: false,
        dataState: 'unavailable',
        code: 'INTERNAL_ERROR',
        requestId: 'request-error',
        timestamp: '2026-08-28T10:00:00.000Z',
      });
      expect(JSON.stringify(body)).not.toContain('database-password');
    });
  });

  describe('jsonOk', () => {
    it('should return successful JSON response with data', () => {
      const data = { message: 'Success', id: '123' };
      const response = jsonOk(data);

      expect(response.status).toBe(200);
    });

    it('should include correct headers', () => {
      const response = jsonOk({ test: true });
      const headers = response.headers;

      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('should serialize data correctly', async () => {
      const data = { message: 'Success', count: 42 };
      const response = jsonOk(data);
      const body = await response.json();

      expect(body).toMatchObject({
        ...data,
        success: true,
        data,
        dataState: 'available',
      });
      expect(body.requestId).toBeTypeOf('string');
      expect(body.timestamp).toBeTypeOf('string');
    });

    it('should handle null data', async () => {
      const response = jsonOk(null);
      const body = await response.json();

      expect(body).toMatchObject({ success: true, data: null, dataState: 'no_data' });
    });

    it('should handle arrays', async () => {
      const data = [1, 2, 3];
      const response = jsonOk(data);
      const body = await response.json();

      expect(body).toMatchObject({ success: true, data, dataState: 'available' });
    });

    it('should allow custom status code', () => {
      const response = jsonOk({ created: true }, 201);

      expect(response.status).toBe(201);
    });

    it('should allow custom headers', () => {
      const response = jsonOk({ ok: true }, 200, {
        'Cache-Control': 'public, max-age=60',
      });

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    });

    it('can preserve selected legacy top-level aliases without nesting an existing envelope', async () => {
      const metrics = { mtta: 12, mttr: 34 };
      const meta = { source: 'live' };
      const response = jsonOk(metrics, 200, undefined, { meta });

      await expect(response.json()).resolves.toMatchObject({
        success: true,
        data: metrics,
        dataState: 'available',
        meta,
      });
    });
  });

  describe('jsonError', () => {
    it('should return error response with status and message', () => {
      const response = jsonError('Something went wrong', 500);

      expect(response.status).toBe(500);
    });

    it('should return error response with custom status', () => {
      const response = jsonError('Not found', 404);

      expect(response.status).toBe(404);
    });

    it('should include error message in response body', async () => {
      const errorMessage = 'Custom error message';
      const response = jsonError(errorMessage, 400);
      const body = await response.json();

      expect(body.error).toBeDefined();
      expect(typeof body.error).toBe('string');
    });

    it('should include meta data if provided', async () => {
      const meta = { field: 'email', code: 'VALIDATION_ERROR' };
      const response = jsonError('Validation failed', 400, meta);
      const body = await response.json();

      expect(body.meta).toEqual(meta);
    });

    it('should handle different status codes', () => {
      const statusCodes = [400, 401, 403, 404, 500];

      statusCodes.forEach(status => {
        const response = jsonError('Error', status);
        expect(response.status).toBe(status);
      });
    });

    it('uses the registry HTTP status for AppError even when a conflicting status is supplied', async () => {
      const error = new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Incident not found.',
      });

      const response = jsonError(error, 500);
      const body = await response.json();

      expect(response.status).toBe(ERROR_REGISTRY.RESOURCE_NOT_FOUND.status);
      expect(response.status).toBe(404);
      expect(body.error).toBe('Incident not found.');
      expect(body.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('preserves the legacy error string field for typed errors', async () => {
      const error = new AppError({ code: 'VALIDATION_FAILED' });
      const response = jsonError(error);
      const body = await response.json();

      expect(body.error).toBe(ERROR_REGISTRY.VALIDATION_FAILED.userMessage);
      expect(body.code).toBe('VALIDATION_FAILED');
    });

    it('preserves response headers for typed errors', async () => {
      const error = new AppError({
        code: 'RATE_LIMIT_EXCEEDED',
        userMessage: 'Rate limit exceeded.',
      });
      const response = jsonError(error, undefined, undefined, { 'Retry-After': '30' });
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('30');
      expect(body.error).toBe('Rate limit exceeded.');
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.retryable).toBe(true);
    });

    it('keeps explicit plain string compatibility without reclassifying the text', async () => {
      const response = jsonError('Unauthorized legacy message', 422);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error).toBe('Unauthorized legacy message');
      expect(body.code).toBe('LEGACY_API_ERROR');
      expect(body.success).toBe(false);
      expect(body.dataState).toBe('unavailable');
    });

    it('normalizes an unknown Error to the typed INTERNAL_ERROR contract without leaking its message', async () => {
      const response = jsonError(new Error('postgres-secret-connection-string'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe(ERROR_REGISTRY.INTERNAL_ERROR.userMessage);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.action).toBe(ERROR_REGISTRY.INTERNAL_ERROR.action);
      expect(body.retryable).toBe(true);
      expect(JSON.stringify(body)).not.toContain('postgres-secret-connection-string');
    });

    it('enforces internal exposure at the API boundary', async () => {
      const error = new AppError({
        code: 'INTERNAL_ERROR',
        userMessage: 'secret-provider-response',
        action: 'expose-secret-action',
        fields: [{ field: 'token', message: 'secret-field-value' }],
        details: { token: 'secret-details-token' },
      });

      const response = jsonError(error);
      const body = await response.json();
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(500);
      expect(body.error).toBe(ERROR_REGISTRY.INTERNAL_ERROR.userMessage);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.action).toBe(ERROR_REGISTRY.INTERNAL_ERROR.action);
      expect(body.fields).toBeUndefined();
      expect(serialized).not.toContain('secret-provider-response');
      expect(serialized).not.toContain('expose-secret-action');
      expect(serialized).not.toContain('secret-field-value');
      expect(serialized).not.toContain('secret-details-token');
    });
  });
});
