/**
 * Next's own SIGTERM/SIGINT handler closes the HTTP server and then calls `process.exit(143)`.
 * With no traffic that happens within milliseconds, before the application's drain (job worker,
 * scheduler, MCP call-log flush) has finished. While a drain is pending, hold the exit until it
 * settles, or until `maxWaitMs`. The platform's kill timer remains the outer bound.
 */
export function deferExitWhileDraining(
  target: { exit: (code?: number | string | null) => never },
  pendingDrain: () => Promise<unknown> | null,
  maxWaitMs: number
): () => void {
  const realExit = target.exit;
  target.exit = ((code?: number | string | null) => {
    const drain = pendingDrain();
    if (!drain) return realExit.call(target, code);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<void>(resolve => {
      timer = setTimeout(resolve, maxWaitMs);
    });
    void Promise.race([drain.catch(() => undefined), cap]).finally(() => {
      clearTimeout(timer);
      realExit.call(target, code);
    });
    // The real exit follows once the drain settles; callers of exit() expect it not to return.
    return undefined as never;
  }) as typeof target.exit;
  return () => {
    target.exit = realExit;
  };
}
