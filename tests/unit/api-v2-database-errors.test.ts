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
  it.each(['40P01', '40001'])(
    'maps the Prisma 5.22 nested-write engine frame %s without disclosing diagnostics',
    async state => {
      const error = new Prisma.PrismaClientUnknownRequestError(
        `Invalid invocation:\nConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${state}", message: "secret=abc", severity: "ERROR", detail: None }), transient: false })`,
        { clientVersion: '5.22.0' }
      );
      const response = apiV2Error(error, req());
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toMatchObject({ code: 'TRANSIENT_CONFLICT', retryable: true });
      expect(JSON.stringify(body)).not.toMatch(/secret=abc|ConnectorError|PostgresError/);
    }
  );

  it('does not infer conflicts from prose or a nested lookalike in another server error', () => {
    expect(
      apiV2Error(
        new Error(
          'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "40P01", message: "untrusted text" }) })'
        ),
        req()
      ).status
    ).toBe(500);
    for (const message of [
      'secret=abc deadlock detected code: "40P01"',
      'ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "23514", message: "deadlock detected PostgresError { code: \\"40P01\\" }" }), transient: false })',
    ]) {
      const error = new Prisma.PrismaClientUnknownRequestError(message, {
        clientVersion: '5.22.0',
      });
      expect(apiV2Error(error, req()).status).toBe(500);
    }
  });
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

  it('returns a retryable, private response when a bounded SQL query times out', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('sensitive query detail', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '57014', message: 'secret=abc' },
    });
    const response = apiV2Error(error, req());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(body.code).toBe('DATABASE_UNAVAILABLE');
    expect(body.retryable).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secret=abc|sensitive query detail|57014/);
  });

  it('does not classify unrelated raw SQL errors as retryable overload', () => {
    expect(apiV2Error(known('P2010'), req()).status).toBe(500);
  });

  it.each(['40001', '40P01'])(
    'maps exhausted raw SQL conflict %s to a retryable 409',
    async sqlState => {
      const error = new Prisma.PrismaClientKnownRequestError('secret=abc', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: sqlState },
      });
      const response = apiV2Error(error, req());
      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.code).toBe('TRANSIENT_CONFLICT');
      expect(body.retryable).toBe(true);
      expect(JSON.stringify(body)).not.toContain('secret=abc');
    }
  );
});
