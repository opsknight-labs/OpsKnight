import { Prisma } from '@prisma/client';
import { rawSqlState } from '@/lib/db/errors';

/** Extract machine SQLSTATE only; never classify by database message prose. */
export function postgresSqlState(error: unknown): string | null {
  // Prisma 7 driver adapters report raw-SQL failures as P2010 with the SQLSTATE in
  // meta.driverAdapterError; the branches below handle the Prisma 5 engine shapes.
  const adapterState = rawSqlState(error);
  if (adapterState) return adapterState;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const state = error.meta?.code ?? error.meta?.database_code;
    return typeof state === 'string' && /^[0-9A-Z]{5}$/.test(state) ? state : null;
  }
  if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) return null;
  // Prisma 5.22 omits structured SQLSTATE for some nested-write failures.
  // Its engine frame starts at column zero, after invocation diagnostics.
  // Read only that frame's first code, never SQL text, detail, or message.
  // A nested lookalike inside the quoted server message cannot override it.
  const frame =
    /^ConnectorError\(ConnectorError \{ user_facing_error: None, kind: QueryError\(PostgresError \{ code: "([0-9A-Z]{5})",/m.exec(
      error.message
    );
  return frame?.[1] ?? null;
}
