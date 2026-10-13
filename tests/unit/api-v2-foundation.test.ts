import { describe, expect, it } from 'vitest';
import {
  apiV2Success,
  apiV2Created,
  apiV2Error,
  apiV2NoContent,
  buildCursorWhere,
  decodeCursor,
  encodeCursor,
  formatCursorPagination,
  parsePaginationParams,
  MemoryLruCache,
  getOpenApiV2Spec,
} from '@/lib/api-v2';
import { AppError } from '@/lib/errors';
import { z } from 'zod';

describe('API v2 Foundation', () => {
  describe('MemoryLruCache', () => {
    it('stores and retrieves values with TTL and respects max size', () => {
      const cache = new MemoryLruCache<string>(3, 500);
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');

      expect(cache.get('k1')).toBe('v1');
      expect(cache.get('k2')).toBe('v2');
      expect(cache.get('k3')).toBe('v3');

      // Adding 4th should evict k1 (oldest accessed was k1, wait, k1 was accessed, then k2, k3)
      cache.set('k4', 'v4');
      expect(cache.size).toBe(3);
      expect(cache.get('k4')).toBe('v4');
    });

    it('returns undefined for expired entries', async () => {
      const cache = new MemoryLruCache<string>(10, 10); // 10ms TTL
      cache.set('k1', 'v1');
      expect(cache.get('k1')).toBe('v1');

      await new Promise(r => setTimeout(r, 20));
      expect(cache.get('k1')).toBeUndefined();
    });
  });

  describe('Pagination', () => {
    it('encodes and decodes base64url cursor safely', () => {
      const original = { id: 'inc_123', createdAt: '2026-10-13T12:00:00.000Z' };
      const cursor = encodeCursor(original);
      expect(typeof cursor).toBe('string');

      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual(original);
    });

    it('throws AppError on malformed cursor', () => {
      expect(() => decodeCursor('invalid-cursor-!!!')).toThrowError();
    });

    it('parses valid pagination parameters and clamps limit', () => {
      const params = new URLSearchParams('limit=250&cursor=abc');
      const { limit, cursor } = parsePaginationParams(params);
      expect(limit).toBe(100); // Clamped to MAX_PAGE_LIMIT
      expect(cursor).toBe('abc');
    });

    it('builds index-friendly cursor where clause', () => {
      const cursor = encodeCursor({ id: 'inc_123', createdAt: '2026-10-13T12:00:00.000Z' });
      const where = buildCursorWhere(cursor);
      expect(where.OR).toBeDefined();
      expect(where.OR).toHaveLength(2);
    });

    it('formats cursor pagination from item list correctly', () => {
      const items = [
        { id: '1', createdAt: new Date('2026-10-13T12:00:00.000Z') },
        { id: '2', createdAt: new Date('2026-10-13T11:00:00.000Z') },
        { id: '3', createdAt: new Date('2026-10-13T10:00:00.000Z') },
      ];

      // Limit 2 (items.length is 3 => hasMore = true)
      const result = formatCursorPagination(items, 2);
      expect(result.data).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBeDefined();

      // Decode next cursor to verify it points to 2nd item
      const decoded = decodeCursor(result.pagination.nextCursor!);
      expect(decoded.id).toBe('2');
    });
  });

  describe('Responses & RFC 9457 Problem Details', () => {
    it('formats success response with envelope and request ID', async () => {
      const res = apiV2Success({ test: true });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('x-request-id')).toBeTruthy();

      const body = await res.json();
      expect(body.data).toEqual({ test: true });
      expect(body.requestId).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it('formats 201 Created response', async () => {
      const res = apiV2Created({ id: 'new_item' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe('new_item');
    });

    it('formats 204 No Content response', () => {
      const res = apiV2NoContent();
      expect(res.status).toBe(204);
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });

    it('formats RFC 9457 error response from AppError', async () => {
      const error = new AppError({
        code: 'INCIDENT_NOT_FOUND',
        status: 404,
        userMessage: 'Incident inc_404 does not exist.',
      });

      const res = apiV2Error(error);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/problem+json');

      const problem = await res.json();
      expect(problem.type).toBe('https://opsknight.com/errors/incident-not-found');
      expect(problem.status).toBe(404);
      expect(problem.code).toBe('INCIDENT_NOT_FOUND');
      expect(problem.detail).toBe('Incident inc_404 does not exist.');
      expect(problem.requestId).toBeTruthy();
    });

    it('formats RFC 9457 validation error from ZodError', async () => {
      const schema = z.object({ title: z.string().min(3) });
      const parsed = schema.safeParse({ title: 'ab' });
      expect(parsed.success).toBe(false);

      if (!parsed.success) {
        const res = apiV2Error(parsed.error);
        expect(res.status).toBe(400);
        const problem = await res.json();
        expect(problem.code).toBe('VALIDATION_FAILED');
        expect(problem.fields).toBeDefined();
        expect(problem.fields[0].field).toBe('title');
      }
    });
  });

  describe('OpenAPI 3.1 Spec', () => {
    it('produces valid OpenAPI 3.1 schema', () => {
      const spec = getOpenApiV2Spec();
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.info).toBeDefined();
      expect(spec.paths).toBeDefined();
      expect(spec.components).toBeDefined();
    });
  });
});
