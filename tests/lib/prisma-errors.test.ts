import { describe, expect, it } from 'vitest';
import {
  getPrismaErrorInfo,
  getPrismaUniqueFields,
  isPrismaErrorCode,
  prismaToAppError,
} from '@/lib/prisma-errors';

describe('Prisma error normalization', () => {
  it('extracts structured Prisma codes and unique fields without reading messages', () => {
    const error = {
      code: 'P2002',
      meta: { target: ['subdomain', 'tenantId'] },
      message: 'arbitrary database wording',
    };

    expect(getPrismaErrorInfo(error)).toEqual({
      code: 'P2002',
      fields: ['subdomain', 'tenantId'],
    });
    expect(getPrismaUniqueFields(error)).toEqual(['subdomain', 'tenantId']);
    expect(isPrismaErrorCode(error, 'P2002')).toBe(true);
  });

  it('ignores non-Prisma error codes', () => {
    expect(getPrismaErrorInfo({ code: 'SQLITE_CONSTRAINT' })).toBeUndefined();
    expect(getPrismaErrorInfo(new Error('P2002 in message only'))).toBeUndefined();
  });

  it('maps P2002 through domain-supplied conflict semantics', () => {
    const error = { code: 'P2002', meta: { target: ['customDomain'] } };
    const mapped = prismaToAppError(error, {
      unique: fields => ({
        code: 'VALIDATION_FAILED',
        userMessage: `Duplicate: ${fields.join(',')}`,
        fields: fields.map(field => ({
          field,
          code: 'duplicate',
          message: 'Already in use',
        })),
      }),
    });

    expect(mapped?.code).toBe('VALIDATION_FAILED');
    expect(mapped?.status).toBe(400);
    expect(mapped?.fields).toEqual([
      { field: 'customDomain', code: 'duplicate', message: 'Already in use' },
    ]);
    expect(mapped?.details).toMatchObject({
      prismaCode: 'P2002',
      prismaFields: ['customDomain'],
    });
  });

  it('maps P2025 to the domain not-found code', () => {
    const mapped = prismaToAppError({ code: 'P2025' }, {
      notFound: {
        code: 'STATUS_PAGE_WEBHOOK_NOT_FOUND',
        userMessage: 'Webhook not found',
      },
    });

    expect(mapped?.code).toBe('STATUS_PAGE_WEBHOOK_NOT_FOUND');
    expect(mapped?.status).toBe(404);
  });

  it('does not guess semantics for unmapped Prisma codes', () => {
    expect(prismaToAppError({ code: 'P2003' }, {})).toBeUndefined();
  });
});