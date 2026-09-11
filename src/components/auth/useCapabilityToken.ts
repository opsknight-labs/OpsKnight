'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type CapabilityTokenState = {
  token: string | null;
  ready: boolean;
  clearToken: () => void;
};

function readCapabilityToken(): string | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const fragmentToken = new URLSearchParams(hash).get('token');
  if (fragmentToken) return fragmentToken;

  return new URLSearchParams(window.location.search).get('token');
}

/**
 * Reads an auth capability from a URL fragment (preferred) or legacy query
 * parameter exactly once, then scrubs it from browser history.
 *
 * React development Strict Mode intentionally replays effects. Separate refs
 * track whether capture already happened and retain the captured value across
 * that replay without comparing the capability itself. State publication is
 * deferred to a microtask so the effect synchronizes only with browser history.
 */
export function useCapabilityToken(): CapabilityTokenState {
  const captured = useRef(false);
  const capturedToken = useRef<string | null>(null);
  const [state, setState] = useState<Omit<CapabilityTokenState, 'clearToken'>>({
    token: null,
    ready: false,
  });

  useEffect(() => {
    if (!captured.current) {
      const token = readCapabilityToken();
      capturedToken.current = token;
      captured.current = true;

      if (token) {
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }
    }

    const token = capturedToken.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ token, ready: true });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearToken = useCallback(() => {
    capturedToken.current = null;
    setState(current => ({ ...current, token: null }));
  }, []);

  return { ...state, clearToken };
}
