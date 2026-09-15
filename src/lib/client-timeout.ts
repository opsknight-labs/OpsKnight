'use client';

export class ClientTimeoutError extends Error {
  constructor(message = 'The request timed out.') {
    super(message);
    this.name = 'ClientTimeoutError';
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ClientTimeoutError()), timeoutMs);
  const external = init.signal;
  const abortFromExternal = () => controller.abort(external?.reason);
  external?.addEventListener('abort', abortFromExternal, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !external?.aborted) throw new ClientTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abortFromExternal);
  }
}

export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'The operation timed out.'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ClientTimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
