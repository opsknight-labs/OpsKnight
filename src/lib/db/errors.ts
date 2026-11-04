import { Prisma } from '@prisma/client';

/**
 * Prisma 7 driver-adapter error normalization.
 *
 * With driver adapters Prisma reports database failures as `meta.driverAdapterError.cause`
 * (a typed `kind` plus the PostgreSQL SQLSTATE in `originalCode`) instead of the Prisma 5
 * engine shapes. Some failures, notably a serialization conflict detected at COMMIT of an
 * interactive transaction, even escape as a bare `DriverAdapterError`. OpsKnight classifies
 * errors for retries, HTTP responses and escalation outcomes, so this module is the single
 * place that reads those structures. It never inspects message prose.
 */

export interface DriverAdapterCause {
  kind: string;
  originalCode?: string;
  code?: string;
  table?: string;
  constraint?: { fields?: string[]; index?: string; foreignKey?: unknown };
  host?: string;
  port?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asCause(value: unknown): DriverAdapterCause | null {
  return isObject(value) && typeof value.kind === 'string'
    ? (value as unknown as DriverAdapterCause)
    : null;
}

/** True for a bare adapter error that Prisma did not wrap in a client error. */
export function isDriverAdapterError(
  error: unknown
): error is Error & { cause: DriverAdapterCause } {
  return (
    error instanceof Error && error.name === 'DriverAdapterError' && asCause(error.cause) !== null
  );
}

export function driverAdapterCause(error: unknown): DriverAdapterCause | null {
  if (isDriverAdapterError(error)) return error.cause;
  if (!isObject(error) || !isObject(error.meta)) return null;
  const adapterError = error.meta.driverAdapterError;
  return isObject(adapterError) ? asCause(adapterError.cause) : null;
}

/** Prisma 7's own kind -> error code table (model operations). */
const KIND_TO_PRISMA_CODE: Record<string, string> = {
  AuthenticationFailed: 'P1000',
  DatabaseNotReachable: 'P1001',
  DatabaseDoesNotExist: 'P1003',
  SocketTimeout: 'P1008',
  DatabaseAlreadyExists: 'P1009',
  DatabaseAccessDenied: 'P1010',
  TlsConnectionError: 'P1011',
  ConnectionClosed: 'P1017',
  TransactionAlreadyClosed: 'P1018',
  LengthMismatch: 'P2000',
  UniqueConstraintViolation: 'P2002',
  ForeignKeyConstraintViolation: 'P2003',
  RestrictViolation: 'P2003',
  InvalidInputValue: 'P2007',
  UnsupportedNativeDataType: 'P2010',
  NullConstraintViolation: 'P2011',
  ValueOutOfRange: 'P2020',
  TableDoesNotExist: 'P2021',
  ColumnNotFound: 'P2022',
  InvalidIsolationLevel: 'P2023',
  InconsistentColumnData: 'P2023',
  TransactionWriteConflict: 'P2034',
  GenericJs: 'P2036',
  TooManyConnections: 'P2037',
};

/**
 * Convert a bare `DriverAdapterError` into the `PrismaClientKnownRequestError` Prisma raises for
 * the same failure in a model operation, so `instanceof` checks and code comparisons keep working.
 */
export function toPrismaClientError<T>(error: T): T | Prisma.PrismaClientKnownRequestError {
  if (!isDriverAdapterError(error)) return error;
  const cause = error.cause;
  const code = KIND_TO_PRISMA_CODE[cause.kind] ?? 'P2039';
  const detail = cause.originalCode ? ` (SQLSTATE ${cause.originalCode})` : '';
  const known = new Prisma.PrismaClientKnownRequestError(`Database error: ${cause.kind}${detail}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    meta: { driverAdapterError: error },
  });
  return known;
}

/** Errors that mean the database cannot currently serve requests (connectivity, capacity, config). */
const UNAVAILABLE_KINDS = new Set([
  'DatabaseNotReachable',
  'SocketTimeout',
  'ConnectionClosed',
  'TooManyConnections',
  'TlsConnectionError',
  'AuthenticationFailed',
  'DatabaseDoesNotExist',
  'DatabaseAccessDenied',
]);

/** Prisma codes with the same meaning (Prisma 5 engine and Prisma 7 adapter codes). */
const UNAVAILABLE_CODES = new Set([
  'P1000', // authentication failed
  'P1001', // cannot reach database server
  'P1002', // database server timed out
  'P1003', // database does not exist
  'P1008', // operation timed out (includes pool acquisition timeout)
  'P1010', // access denied
  'P1011', // TLS connection error
  'P1017', // server closed the connection
  'P2024', // Prisma 5: timed out fetching a connection from the pool
  'P2037', // too many database connections
]);

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  const cause = driverAdapterCause(error);
  if (cause && UNAVAILABLE_KINDS.has(cause.kind)) return true;
  return error instanceof Prisma.PrismaClientKnownRequestError && UNAVAILABLE_CODES.has(error.code);
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * SQLSTATE of a failed raw SQL statement (`$queryRaw`/`$executeRaw`, Prisma code P2010) or of a
 * generic database error (P2039). Model-operation errors (P2002, P2034, ...) deliberately return
 * null, exactly as Prisma 5 did, so callers keep classifying them by Prisma code.
 */
export function rawSqlState(error: unknown): string | null {
  const normalized = toPrismaClientError(error);
  if (!(normalized instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (normalized.code !== 'P2010' && normalized.code !== 'P2039') return null;
  const cause = driverAdapterCause(normalized);
  const state = cause?.originalCode ?? (cause?.kind === 'postgres' ? cause.code : undefined);
  return typeof state === 'string' && SQLSTATE.test(state) ? state : null;
}

function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed;
}

/**
 * Field names of a violated unique constraint. Prisma 5 reported them as `meta.target`; the
 * driver adapter reports the constraint name, which for Prisma-managed constraints follows
 * `<Table>_<column>[_<column>...]_key`. Custom (`map:`) or truncated names are returned as-is.
 * Depending on the adapter version the cause carries either the column list or the name.
 */
export function uniqueConstraintFields(error: unknown): string[] {
  const cause = driverAdapterCause(error);
  if (!cause || cause.kind !== 'UniqueConstraintViolation') return [];
  // Column lists parsed from PostgreSQL's error detail keep SQL identifier quoting ("userId").
  if (cause.constraint?.fields?.length) return cause.constraint.fields.map(unquoteIdentifier);
  const index = cause.constraint?.index;
  if (!index) return [];
  const modelName = isObject(error) && isObject(error.meta) ? error.meta.modelName : undefined;
  const table = cause.table ?? (typeof modelName === 'string' ? modelName : undefined);
  const prefix = table ? `${table}_` : undefined;
  if (prefix && index.startsWith(prefix) && index.endsWith('_key')) {
    const columns = index.slice(prefix.length, -'_key'.length).split('_').filter(Boolean);
    if (columns.length) return columns;
  }
  return [index];
}
