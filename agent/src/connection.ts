/** Startup/reconnect only. Execution start/result/side-effect retries remain governed by their fences. */
export async function recoverStartup<T>(
  operation: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    report: (reason: string) => Promise<void>;
    wait?: (ms: number) => Promise<void>;
  }
) {
  let failures = 0;
  while (!options.signal?.aborted) {
    try {
      return await operation();
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error ? Number(error.status) : null;
      if (status !== null && [400, 401, 403, 404, 409, 410, 422].includes(status)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|timeout|timed out|HTTP 5\d\d|HTTP 429|aborted/i.test(
          message
        )
      )
        throw error;
      failures++;
      await options.report(
        'Waiting for the control plane. Enrollment has not completed; execution remains disabled.'
      );
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5));
      if (options.wait) await options.wait(delay);
      else
        await new Promise<void>(resolve => {
          const finish = () => {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, delay + Math.floor(Math.random() * delay * 0.2));
          options.signal?.addEventListener('abort', finish, { once: true });
          if (options.signal?.aborted) finish();
        });
    }
  }
  throw new Error('Agent initialization cancelled.');
}
