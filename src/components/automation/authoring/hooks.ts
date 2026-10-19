'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Returns a callback with a permanent identity that always invokes the latest `fn`.
 * Lets memoized rows skip re-rendering when the parent recreates its handlers each render.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result
): (...args: Args) => Result {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

/** Keeps the previous array identity while its items are referentially unchanged. */
export function useShallowStableArray<T>(items: T[]): T[] {
  const [stable, setStable] = useState(items);
  const same =
    stable === items ||
    (stable.length === items.length && stable.every((item, index) => item === items.at(index)));
  if (!same) setStable(items);
  return same ? stable : items;
}
