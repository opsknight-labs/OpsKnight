const SAVEPOINT_NAME = /^[a-z_][a-z0-9_]{0,40}$/;

/**
 * Run an OPTIONAL statement inside an interactive transaction under a SAVEPOINT.
 *
 * PostgreSQL aborts the whole transaction when any statement fails (a statement timeout, a
 * deadlock victim), so a caller that catches the error and carries on would fail on the very next
 * statement. A failed `work` rolls back to the savepoint, which leaves the transaction usable, then
 * rethrows so the caller can fall back. On the pooled root client there is no transaction to
 * protect, so `work` simply runs. `name` is interpolated: pass a constant, never user input.
 */
export async function withSavepoint<T>(
  client: { $executeRawUnsafe: (query: string) => PromiseLike<unknown> },
  name: string,
  work: () => Promise<T>
): Promise<T> {
  if (!SAVEPOINT_NAME.test(name)) throw new Error(`Invalid savepoint name: ${name}`);
  if ('$transaction' in client) return work();
  await client.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const result = await work();
    await client.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
