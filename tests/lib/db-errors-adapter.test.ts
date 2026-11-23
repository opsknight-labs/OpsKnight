import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import {
  driverAdapterCause,
  isDatabaseUnavailableError,
  isDriverAdapterError,
  rawSqlState,
  toPrismaClientError,
  uniqueConstraintFields,
} from '@/lib/db/errors';
import { mapDatabaseError } from '@/lib/api-v2/database-errors';
import { isRetryableTransactionError } from '@/lib/db-utils';
import { escalationOutcomeForError } from '@/lib/escalation/types';
import { isAppError } from '@/lib/errors';
import { getPrismaErrorInfo } from '@/lib/prisma-errors';
import { postgresSqlState } from '@/lib/postgres-error';

const known = (code: string, cause?: Record<string, unknown>, meta: Record<string, unknown> = {}) =>
  new Prisma.PrismaClientKnownRequestError('test', {
    code,
    clientVersion: '7.10.1',
    meta: cause ? { ...meta, driverAdapterError: new DriverAdapterError(cause as never) } : meta,
  });

describe('Prisma 7 driver adapter error normalization', () => {
  it('reads the SQLSTATE of raw SQL failures only', () => {
    const raw = known('P2010', { kind: 'TransactionWriteConflict', originalCode: '40001' });
    expect(rawSqlState(raw)).toBe('40001');
    expect(postgresSqlState(raw)).toBe('40001');
    expect(isRetryableTransactionError(raw)).toBe(true);
    const generic = known('P2010', { kind: 'postgres', code: '42601', originalCode: '42601' });
    expect(postgresSqlState(generic)).toBe('42601');
    // Model errors keep Prisma code semantics (Prisma 5 had no SQLSTATE for them).
    const unique = known('P2002', { kind: 'UniqueConstraintViolation', originalCode: '23505' });
    expect(postgresSqlState(unique)).toBeNull();
    expect(isRetryableTransactionError(unique)).toBe(true);
  });

  it('converts a bare commit-time DriverAdapterError into the equivalent client error', () => {
    const bare = new DriverAdapterError({ kind: 'TransactionWriteConflict' } as never);
    expect(isDriverAdapterError(bare)).toBe(true);
    const converted = toPrismaClientError(bare);
    expect(converted).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((converted as Prisma.PrismaClientKnownRequestError).code).toBe('P2034');
    expect(driverAdapterCause(converted)?.kind).toBe('TransactionWriteConflict');
    expect(isRetryableTransactionError(bare)).toBe(true);
    const mapped = mapDatabaseError(bare);
    expect(isAppError(mapped) && mapped.code).toBe('TRANSIENT_CONFLICT');
    expect(escalationOutcomeForError(bare)).toBe('RETRYABLE_FAILURE');
    expect(toPrismaClientError(new Error('other'))).toBeInstanceOf(Error);
  });

  it('classifies connectivity, pool and configuration failures as unavailable', () => {
    for (const error of [
      known('P1001', { kind: 'DatabaseNotReachable' }),
      known('P2010', { kind: 'DatabaseNotReachable' }),
      known('P2010', { kind: 'SocketTimeout' }),
      known('P1008', { kind: 'SocketTimeout' }),
      known('P1017', { kind: 'ConnectionClosed' }),
      known('P2037', { kind: 'TooManyConnections' }),
      known('P1000', { kind: 'AuthenticationFailed' }),
      known('P2024'),
    ]) {
      expect(isDatabaseUnavailableError(error)).toBe(true);
      const mapped = mapDatabaseError(error);
      expect(isAppError(mapped) && mapped.code).toBe('DATABASE_UNAVAILABLE');
      expect(escalationOutcomeForError(error)).toBe('RETRYABLE_FAILURE');
    }
    expect(isDatabaseUnavailableError(known('P2002'))).toBe(false);
    const rawUnique = known('P2010', { kind: 'UniqueConstraintViolation', originalCode: '23505' });
    expect(mapDatabaseError(rawUnique)).toBe(rawUnique);
  });

  it('derives unique fields from Prisma-managed constraint names', () => {
    const single = known(
      'P2002',
      {
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'StatusPage_subdomain_key' },
        table: 'StatusPage',
      },
      { modelName: 'StatusPage' }
    );
    expect(uniqueConstraintFields(single)).toEqual(['subdomain']);
    expect(getPrismaErrorInfo(single)).toEqual({ code: 'P2002', fields: ['subdomain'] });
    const composite = known('P2002', {
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'TeamMember_userId_teamId_key' },
      table: 'TeamMember',
    });
    expect(uniqueConstraintFields(composite)).toEqual(['userId', 'teamId']);
    const custom = known('P2002', {
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'IncidentClassificationPolicyRule_match_key' },
      table: 'Other',
    });
    expect(uniqueConstraintFields(custom)).toEqual(['IncidentClassificationPolicyRule_match_key']);
    const explicit = known('P2002', {
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ['a'] },
    });
    expect(uniqueConstraintFields(explicit)).toEqual(['a']);
    const quoted = known('P2002', {
      kind: 'UniqueConstraintViolation',
      constraint: { fields: ['"userId"', '"teamId"'] },
    });
    expect(uniqueConstraintFields(quoted)).toEqual(['userId', 'teamId']);
    // Prisma 5 shape still wins when present.
    expect(getPrismaErrorInfo({ code: 'P2002', meta: { target: ['email'] } })?.fields).toEqual([
      'email',
    ]);
  });
});
