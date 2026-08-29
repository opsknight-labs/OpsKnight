export interface RequestContext {
  requestId?: string;
  userId?: string;
  component?: string;
}

interface AsyncLocalStorageLike<T> {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
}

class FallbackAsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
  private store: T | undefined;

  run<R>(store: T, callback: () => R): R {
    const previous = this.store;
    this.store = store;
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }

  getStore(): T | undefined {
    return this.store;
  }
}

function createAsyncLocalStorage<T>(): AsyncLocalStorageLike<T> {
  try {
    // Avoid a static node:async_hooks import because request correlation is
    // also bundled for browser and Edge consumers.
    const runtimeProcess = (
      globalThis as unknown as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    const asyncHooks = runtimeProcess?.getBuiltinModule?.('node:async_hooks') as
      | { AsyncLocalStorage?: new <V>() => AsyncLocalStorageLike<V> }
      | undefined;
    if (typeof asyncHooks?.AsyncLocalStorage === 'function') {
      return new asyncHooks.AsyncLocalStorage<T>();
    }
  } catch {
    // Use the synchronous fallback when AsyncLocalStorage is unavailable.
  }
  return new FallbackAsyncLocalStorage<T>();
}

export const requestContextStorage = createAsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

export function getRequestContext(): RequestContext {
  return requestContextStorage.getStore() ?? {};
}
