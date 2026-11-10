'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readSquireDeepLink, withoutSquireDeepLink } from './deep-link';
import { useSquireDock, type SquireDock } from './dock';
import type { SquireEvidenceHandle, SquireOpenRequest } from './squire-bus';

/**
 * Everything the launcher needs for its entry points, kept out of the launcher itself: the docked
 * display, the evidence handle a hand-off carried, and the `?squire=open&q=` deep link.
 */
export interface SquireSurfaces {
  dock: SquireDock;
  /** The item the current question is about, when a hand-off named one on this page. */
  evidence: SquireEvidenceHandle | null;
  clearEvidence: () => void;
  /** Apply the parts of a bus request that are not "send this message". */
  receive: (request: SquireOpenRequest) => void;
}

export function useSquireSurfaces({
  pathname,
  incidentId,
  open,
  fullscreen = false,
  onOpen,
  onPrefill,
}: {
  pathname: string | null;
  incidentId?: string;
  open: boolean;
  fullscreen?: boolean;
  onOpen: () => void;
  onPrefill: (question: string) => void;
}): SquireSurfaces {
  const dock = useSquireDock({ open, fullscreen, incidentId });
  const { suggestDock } = dock;
  // Evidence belongs to the page it was handed over on; navigating away drops it.
  const [held, setHeld] = useState<{ path: string | null; handle: SquireEvidenceHandle } | null>(
    null
  );
  const evidence = held && held.path === pathname ? held.handle : null;
  const clearEvidence = useCallback(() => setHeld(null), []);

  const latest = useRef({ pathname, incidentId, onOpen, onPrefill });
  useEffect(() => {
    latest.current = { pathname, incidentId, onOpen, onPrefill };
  });

  const receive = useCallback(
    (request: SquireOpenRequest) => {
      const now = latest.current;
      if (request.incidentId && request.incidentId === now.incidentId)
        suggestDock(request.incidentId);
      setHeld(request.evidence ? { path: now.pathname, handle: request.evidence } : null);
      if (!request.message && request.question) now.onPrefill(request.question);
    },
    [suggestDock]
  );

  useEffect(() => {
    const link = readSquireDeepLink(window.location.search);
    if (!link) return;
    latest.current.onOpen();
    if (link.question) latest.current.onPrefill(link.question);
    try {
      window.history.replaceState(
        window.history.state,
        '',
        withoutSquireDeepLink(window.location.href)
      );
    } catch {
      // The link still worked; only the address bar keeps its parameters.
    }
  }, [pathname]);

  return { dock, evidence, clearEvidence, receive };
}
