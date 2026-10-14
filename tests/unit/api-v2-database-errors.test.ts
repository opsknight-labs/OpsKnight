import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { apiV2Error } from '@/lib/api-v2/response';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db detail with secret=abc', {
    code,
    clientVersion: 'test',
  });
const req = () => new NextRequest('http://x/api/v2/teams');

describe('REST v2 database error mapping', () => {
  it.each([
    ['P2002', 409, 'RESOURCE_CONFLICT'],
    ['P2003', 409, 'RESOURCE_CONFLICT'],
    ['P2025', 404, 'RESOURCE_NOT_FOUND'],
    ['P2034', 409, 'TRANSIENT_CONFLICT'],
    ['P1001', 503, 'DATABASE_UNAVAILABLE'],
    ['P2024', 503, 'DATABASE_UNAVAILABLE'],
  ])('maps %s to %i %s without leaking driver detail', async (prismaCode, status, code) => {
    const response = apiV2Error(known(prismaCode), req());
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain('secret=abc');
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });

  it('marks outages retryable and sends Retry-After', async () => {
    const response = apiV2Error(known('P1001'), req());
    expect(response.headers.get('Retry-After')).toBe('2');
    expect((await response.json()).retryable).toBe(true);
  });

  it('leaves unknown errors as a generic 500', async () => {
    const response = apiV2Error(new Error('boom'), req());
    expect(response.status).toBe(500);
  });
});
