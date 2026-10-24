import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
const quiesce = createRequire(import.meta.url)('../../scripts/ingestion/quiesce-admission.cjs');
const databaseUrl = 'postgresql://127.0.0.1:55445/ingestion_test_http_owned';
function fixture() {
  return {
    $disconnect: vi.fn(),
    systemConfig: {
      findUnique: vi.fn().mockResolvedValue({ value: { revision: 9, policy: { concurrency: 4 } } }),
      upsert: vi.fn(),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ database: 'ingestion_test_http_owned' }])
      .mockResolvedValueOnce([{ barrier: new Date() }])
      .mockResolvedValue([{ pending: 0 }]),
  };
}
afterEach(() => vi.useRealTimers());
describe('fixture admission reconciliation barrier', () => {
  it('pins host diagnostics to the validated datasource under an inherited web role', () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "require('./scripts/ingestion/isolated-runtime.cjs'); process.stdout.write(String(process.env.WEB_DATABASE_URL === process.env.DATABASE_URL));",
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          WEB_DATABASE_URL: 'postgresql://127.0.0.1:1/shared',
          OPSKNIGHT_PROCESS_ROLE: 'web',
        },
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('true');
  });

  it('refuses other databases before mutating policy', async () => {
    const db = fixture();
    await expect(
      quiesce({ createClient: () => db, databaseUrl: 'postgresql://127.0.0.1:55445/customer' })
    ).rejects.toThrow();
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
  });
  it('rejects a mismatched actual database before policy writes', async () => {
    const db = fixture();
    db.$queryRaw.mockReset().mockResolvedValueOnce([{ database: 'shared_customer' }]);
    await expect(quiesce({ databaseUrl, createClient: () => db })).rejects.toThrow(
      'Fixture datasource mismatch'
    );
    expect(db.systemConfig.upsert).not.toHaveBeenCalled();
    expect(db.$disconnect).toHaveBeenCalledOnce();
  });

  it('constructs the client with the validated explicit datasource', async () => {
    const db = fixture();
    const createClient = vi.fn((_datasourceUrl: string) => db);
    await quiesce({ databaseUrl, createClient });
    const selected = new URL(createClient.mock.calls[0][0]);
    expect(selected.pathname).toBe('/ingestion_test_http_owned');
    expect(selected.hostname).toBe('127.0.0.1');
    expect(selected.port).toBe('55445');
    expect(selected.searchParams.get('connection_limit')).toBe('1');
    expect(db.$disconnect).toHaveBeenCalledOnce();
  });

  it('preserves policy and closes admission before checking old transactions', async () => {
    const db = fixture();
    const result = await quiesce({ createClient: () => db, databaseUrl });
    expect(result.passed).toBe(true);
    expect(db.systemConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { value: { revision: 9, paused: true, policy: { concurrency: 4 } } },
      })
    );
    expect(db.systemConfig.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      db.$queryRaw.mock.invocationCallOrder[1]
    );
  });
  it('takes the settled snapshot only after an old transaction finishes', async () => {
    vi.useFakeTimers();
    const db = fixture();
    db.$queryRaw.mockResolvedValueOnce([{ pending: 1 }]).mockResolvedValueOnce([{ pending: 0 }]);
    let settled = false;
    const task = quiesce({ createClient: () => db, databaseUrl }).then(
      (result: { passed: boolean }) => {
        settled = true;
        return result;
      }
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await task).passed).toBe(true);
  });

  it('waits for pre-barrier transactions and rejects an unsettled ledger', async () => {
    vi.useFakeTimers();
    const db = fixture();
    db.$queryRaw.mockResolvedValue([{ pending: 1 }]);
    const task = quiesce({ createClient: () => db, databaseUrl, timeoutMs: 1000 });
    const rejection = expect(task).rejects.toThrow('did not settle');
    await vi.advanceTimersByTimeAsync(1001);
    await rejection;
  });
});
