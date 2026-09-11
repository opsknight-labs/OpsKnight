'use client';

import { useEffect, useRef, useState } from 'react';

type CapabilityTokenState = {
  token: string | null;
  ready: boolean;
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
 * React development Strict Mode intentionally replays effects. The ref guard
 * prevents the replay from re-reading the already-scrubbed URL and erasing the
 * in-memory capability.
 */
export function useCapabilityToken(): CapabilityTokenState {
  const capturedToken = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<CapabilityTokenState>({
    token: null,
    ready: false,
  });

  useEffect(() => {
    if (capturedToken.current !== undefined) return;

    const token = readCapabilityToken();
    capturedToken.current = token;
    setState({ token, ready: true });

    if (token) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, []);

  return state;
}
