'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Answers that finish in the background (see conversations/background.ts): the launcher hands a running
 * answer over, lists what is running or finished, and opens a finished one from a notification link.
 */
export const BACKGROUND_URL = '/api/intelligence/squire/background';
export const CONVERSATION_PARAM = 'conversation';
const POLL_MS = 5_000;
const OPENED_KEY = 'opsknight.squire.background.opened';

export type BackgroundTurn = {
  id: string;
  title: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  conversationId: string | null;
  failure: string | null;
  createdAt: string;
  completedAt: string | null;
};

export const isActive = (turn: BackgroundTurn) =>
  turn.status === 'QUEUED' || turn.status === 'RUNNING';

/** `?squire=open&conversation=<id>` (a finished background answer's notification): the conversation id. */
export function readConversationLink(search: string | null | undefined): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  const id = params.get(CONVERSATION_PARAM);
  return params.get('squire') === 'open' && id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function readOpened(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(OPENED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-50) : [];
  } catch {
    return [];
  }
}

export type HandOffResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * The person's background answers, read when the panel opens and refreshed every few seconds while it is
 * open and any is running (a closed panel shows nothing; the notification tells them). Off entirely without
 * saved history.
 */
export function useSquireBackground({ enabled, open }: { enabled: boolean; open: boolean }) {
  const [turns, setTurns] = useState<BackgroundTurn[]>([]);
  // Only used once answers have loaded (after mount), so the server's empty list never mismatches.
  const [opened, setOpened] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : readOpened()
  );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(BACKGROUND_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { data?: { turns?: BackgroundTurn[] } };
      if (alive.current) setTurns(body.data?.turns ?? []);
    } catch {
      // Offline or the server is restarting: the next poll tries again.
    }
  }, []);

  useEffect(() => {
    if (!enabled || !open) return;
    // After the effect, like a subscription callback: the list arrives asynchronously.
    void Promise.resolve().then(refresh);
  }, [enabled, open, refresh]);

  const running = turns.some(isActive);
  useEffect(() => {
    if (!enabled || !open || !running) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, running, open, refresh]);

  /**
   * Hands the running question over. `leaving` sends it as a keepalive request, which the browser finishes
   * even while the page closes.
   */
  const handOff = useCallback(
    async (payload: unknown, leaving = false): Promise<HandOffResult> => {
      try {
        const response = await fetch(BACKGROUND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: leaving,
        });
        if (response.ok) {
          const body = (await response.json().catch(() => null)) as {
            data?: { id?: string };
          } | null;
          void refresh();
          return { ok: true, id: body?.data?.id ?? '' };
        }
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        return {
          ok: false,
          message:
            typeof body?.error === 'string'
              ? body.error
              : 'This answer could not be moved to the background.',
        };
      } catch {
        return { ok: false, message: 'This answer could not be moved to the background.' };
      }
    },
    [refresh]
  );

  const cancel = useCallback(
    async (id: string) => {
      await fetch(`${BACKGROUND_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
        () => undefined
      );
      await refresh();
    },
    [refresh]
  );

  const markOpened = useCallback((id: string) => {
    setOpened(current => {
      const next = [...new Set([...current, id])].slice(-50);
      try {
        window.localStorage.setItem(OPENED_KEY, JSON.stringify(next));
      } catch {
        // Storage can be disabled; the answer then stays marked new for this visit only.
      }
      return next;
    });
  }, []);

  const ready = turns.filter(turn => turn.status === 'DONE' && !opened.includes(turn.id));
  return { turns, ready, refresh, handOff, cancel, markOpened };
}
