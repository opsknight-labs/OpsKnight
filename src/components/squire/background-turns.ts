'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Answers that finish in the background (see conversations/background.ts): the launcher hands a running
 * answer over, lists what is running or finished, and opens a finished one from a notification link.
 */
export const BACKGROUND_URL = '/api/intelligence/squire/background';
export const CONVERSATION_PARAM = 'conversation';
const POLL_MS = 5_000;
/** A handed-off answer is polled every 5 s, every 15 s after 2 minutes, and given up on after the server's deadline. */
const SLOW_AFTER_MS = 120_000;
const SLOW_POLL_MS = 15_000;
const WATCH_DEADLINE_MS = 20 * 60_000;
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
  // The answer this tab handed off: followed whether or not the panel is open, until it finishes.
  const [watching, setWatching] = useState<{ id: string; since: number } | null>(null);
  const [finished, setFinished] = useState<BackgroundTurn | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** When the list was last read; a watched answer is only "gone" after a read made since the hand-off. */
  const refreshedAt = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(BACKGROUND_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { data?: { turns?: BackgroundTurn[] } };
      if (alive.current) setTurns(body.data?.turns ?? []);
      refreshedAt.current = Date.now();
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

  useEffect(() => {
    if (!enabled || !watching) return;
    let timer: number;
    const tick = async () => {
      await refresh();
      if (!alive.current) return;
      const age = Date.now() - watching.since;
      if (age > WATCH_DEADLINE_MS) return setWatching(null);
      timer = window.setTimeout(() => void tick(), age > SLOW_AFTER_MS ? SLOW_POLL_MS : POLL_MS);
    };
    timer = window.setTimeout(() => void tick(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, watching, refresh]);

  // The watched answer reached an end state (or vanished): stop watching and report it once.
  useEffect(() => {
    if (!watching || turns.length === 0) return;
    const turn = turns.find(item => item.id === watching.id);
    if (turn && isActive(turn)) return;
    // An older list that does not hold the new answer yet is not proof that it vanished.
    if (!turn && refreshedAt.current < watching.since) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reacts to the polled list arriving, which is external data */
    setWatching(null);
    if (turn) setFinished(turn);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [turns, watching]);

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
          const id = body?.data?.id ?? '';
          if (id) setWatching({ id, since: Date.now() });
          void refresh();
          return { ok: true, id };
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
  const clearFinished = useCallback(() => setFinished(null), []);
  return { turns, ready, finished, clearFinished, refresh, handOff, cancel, markOpened };
}
