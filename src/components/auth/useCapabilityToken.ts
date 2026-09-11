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
 * React development Strict Mode intentionally replays effects. The ref retains
 * the first capability across that replay, and state publication is deferred to
 * a microtask so the effect itself only synchronizes with browser history.
 */
export function useCapabilityToken(): CapabilityTokenState {
  const capturedToken = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<Omit<CapabilityTokenState, 'clearToken'>>({
    token: null,
    ready: false,
  });

  useEffect(() => {
    let token = capturedToken.current;
    if (token === undefined) {
      token = readCapabilityToken();
      capturedToken.current = token;

      if (token) {
        window.history.replaceState(window.history.state, '', window.location.pathname);
      }
    }

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
