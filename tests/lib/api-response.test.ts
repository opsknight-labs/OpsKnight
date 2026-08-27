import { describe, it, expect } from 'vitest';
import { jsonOk, jsonError } from '@/lib/api-response';
import { AppError, ERROR_REGISTRY } from '@/lib/errors';

describe('API Response Utilities', () => {
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

      expect(body).toEqual(data);
    });

    it('should handle null data', async () => {
      const response = jsonOk(null);
      const body = await response.json();

      expect(body).toBeNull();
    });

    it('should handle arrays', async () => {
      const data = [1, 2, 3];
      const response = jsonOk(data);
      const body = await response.json();

      expect(body).toEqual(data);
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

    it('keeps plain string compatibility', async () => {
      const response = jsonError('Custom legacy message', 422);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error).toBe('Custom legacy message');
    });

    it('normalizes an unknown Error to a generic 500 without leaking its message', async () => {
      const response = jsonError(new Error('postgres-secret-connection-string'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('An unexpected error occurred. Please try again.');
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
