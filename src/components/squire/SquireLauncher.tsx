'use client';

import Link from 'next/link';
import { subscribeSquireOpen } from './squire-bus';
export { openSquire } from './squire-bus';
import { usePathname } from 'next/navigation';
import { useOptionalRealtime } from '@/hooks/useRealtime';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowLeftRight,
  History,
  Send,
  Square,
  Trash2,
  X,
  ArrowDown,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Plus,
  Search,
} from 'lucide-react';
import SquireAvatar, { type SquireAvatarKind } from '@/components/squire/SquireAvatar';
import OpsKnightSquire from './OpsKnightSquire';
import SquireMessage from './SquireMessage';
import { squirePresence, type AiAvailability } from './presence';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import type { StoredTurnEnvelope } from '@/lib/intelligence/conversations/contract';
import type { SquireProposalView } from './SquireProposalCard';

import type { Turn, Citation } from './chat-types';
type SavedConversation = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  incidentId?: string | null;
};
const CONVERSATIONS_URL = '/api/intelligence/squire/conversations';

const HISTORY_TURNS = 10;
const MAX_LENGTH = 2000;
/** The server keeps this much of each earlier turn as context; sending more only wastes the request. */
const HISTORY_TURN_LENGTH = 4000;
const SUGGESTIONS = [
  'What is on fire?',
  'My open incidents',
  'How many incidents this week?',
  'List services',
  'Help',
];
const INCIDENT_SUGGESTIONS = [
  'Similar incidents?',
  'What could have caused this?',
  'Which runbook fits?',
];
const SIDE_KEY = 'opsknight.squire.side';

type Side = 'right' | 'left';
const SIDE_EVENT = 'squire:side';
const readSide = (): Side => {
  try {
    return window.localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
};
const subscribeSide = (onChange: () => void) => {
  window.addEventListener(SIDE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SIDE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
// The server cannot know the user's choice, so it always renders the default side.
const serverSide = (): Side => 'right';
const onlineSnapshot = () => navigator.onLine;
const serverOnline = () => true;
const subscribeOnline = (change: () => void) => {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
};

function incidentIdFrom(pathname: string | null): string | undefined {
  const match = pathname?.match(/^\/incidents\/([A-Za-z0-9_-]{1,64})(?:\/|$)/);
  return match && match[1] !== 'new' ? match[1] : undefined;
}

type PageContext = { kind: 'service' | 'team' | 'schedule' | 'runbook' | 'alert'; id: string };

/** The entity page the person is on, so "this service" or "this team" mean something to the assistant. */
function pageContextFrom(pathname: string | null): PageContext | undefined {
  const match = pathname?.match(
    /^\/(services|teams|schedules|runbooks|alerts)\/([A-Za-z0-9_-]{1,64})(?:\/|$)/
  );
  if (!match || match[2] === 'new') return undefined;
  const kind = match[1].slice(0, -1) as PageContext['kind'];
  return { kind, id: match[2] };
}

export default function SquireLauncher({
  name,
  avatar = 'SQUIRE',
  launcher = 'FLOATING',
  animated = false,
  aiEnabled = false,
  history = null,
}: {
  name: string;
  avatar?: SquireAvatarKind;
  launcher?: 'FLOATING' | 'SEARCH_ONLY';
  animated?: boolean;
  aiEnabled?: boolean;
  /** Set when an administrator has turned on saved conversations. */
  history?: { retentionDays: number } | null;
}) {
  const pathname = usePathname();
  const realtime = useOptionalRealtime();
  const { userTimeZone } = useTimezone();
  const side = useSyncExternalStore(subscribeSide, readSide, serverSide);
  const sendRef = useRef<(message: string, replayFrom?: number) => Promise<void>>(
    async () => undefined
  );
  const incidentId = incidentIdFrom(pathname);
  const pageContext = useMemo(
    () => (incidentId ? undefined : pageContextFrom(pathname)),
    [incidentId, pathname]
  );
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnline);
  const [expanded, setExpanded] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [availability, setAvailability] = useState<AiAvailability>(
    aiEnabled ? 'ready' : 'disabled'
  );
  const [attention, setAttention] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [unread, setUnread] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const turnsRef = useRef(turns);
  const nextTurnId = useRef(0);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    if (!open || !greeting) return;
    const timer = window.setTimeout(() => setGreeting(false), 2500);
    return () => window.clearTimeout(timer);
  }, [open, greeting]);
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j' && !event.altKey) {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);
  const [actionOutcome, setActionOutcome] = useState<'success' | 'error' | null>(null);
  useEffect(() => {
    if (!actionOutcome) return;
    const timer = window.setTimeout(() => setActionOutcome(null), 2400);
    return () => window.clearTimeout(timer);
  }, [actionOutcome]);
  const lastTurn = turns.at(-1);
  const [activeScope, setActiveScope] = useState<string | null | undefined>(undefined);
  const contextMismatch = activeScope !== undefined && activeScope !== (incidentId ?? null);
  const scopeId = activeScope === undefined ? incidentId : activeScope;
  const currentIncident = scopeId
    ? realtime?.recentIncidents.find(row => row.id === scopeId)
    : null;
  const incidentAttention = realtime?.isRevoked
    ? false
    : currentIncident
      ? currentIncident.status === 'OPEN' && currentIncident.urgency === 'HIGH'
      : scopeId
        ? attention
        : Boolean(
            realtime?.recentIncidents.some(row => row.status === 'OPEN' && row.urgency === 'HIGH')
          );
  const presence = squirePresence({
    online,
    greeting: greeting && turns.length === 0,
    busy,
    speaking: Boolean(lastTurn?.content && !lastTurn.activity),
    typing: Boolean(input.trim()),
    failed: Boolean(lastTurn?.failed),
    outcome: actionOutcome,
    attention: incidentAttention,
    availability,
  });
  const mascotState = presence.state;
  const statusLabel =
    mascotState === 'offline' && online
      ? availability === 'quota'
        ? 'Basic mode · AI limit reached'
        : availability === 'unavailable'
          ? 'Basic mode · AI unavailable'
          : 'Basic mode · AI disabled'
      : presence.label;
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [saved, setSaved] = useState<SavedConversation[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Each request gets a number; a stream that is no longer the latest (new chat, opened conversation)
  // cannot write into what is on screen now.
  const requestSeq = useRef(0);
  const pendingRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Closing only hides the panel: an answer in progress keeps arriving and is there when it is reopened.
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    document.documentElement.dataset.squireName = name;
    window.dispatchEvent(new Event('squire:ready'));
    return () => {
      delete document.documentElement.dataset.squireName;
      window.dispatchEvent(new Event('squire:ready'));
    };
  }, [name]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setOpen(true);
      const message = (event as CustomEvent<{ message?: unknown } | undefined>).detail?.message;
      if (typeof message === 'string' && message.trim())
        void sendRef.current(message.slice(0, MAX_LENGTH));
    };
    return subscribeSquireOpen(onOpen);
  }, []);

  const switchSide = useCallback(() => {
    try {
      window.localStorage.setItem(SIDE_KEY, readSide() === 'right' ? 'left' : 'right');
    } catch {
      // Storage can be disabled; the launcher then stays on its default side.
    }
    window.dispatchEvent(new Event(SIDE_EVENT));
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    // Closing returns focus to the launcher so keyboard users are not left at the top of the page.
    else if (wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, busy]);
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [input]);

  const send = useCallback(
    async (raw: string, replayFrom?: number) => {
      const message = raw.trim().slice(0, MAX_LENGTH);
      if (!message || !online) return;
      if (activeScope !== undefined && activeScope !== (incidentId ?? null)) {
        setInput(message);
        return;
      }
      if (busy) {
        // Asked while an answer is still arriving (for example from another part of the page): send it next.
        pendingRef.current = message;
        return;
      }
      if (activeScope === undefined) setActiveScope(incidentId ?? null);
      const priorTurns = replayFrom === undefined ? turns : turns.slice(0, replayFrom);
      const history = priorTurns
        .filter(turn => turn.content && !turn.failed && turn.incidentId === incidentId)
        .slice(-HISTORY_TURNS)
        .map(({ role, content, contextProof }) => ({
          role,
          content: content.slice(0, HISTORY_TURN_LENGTH),
          ...(contextProof ? { contextProof } : {}),
        }));
      const exchange = ++nextTurnId.current;
      setTurns([
        ...priorTurns,
        { id: `live-${exchange}-user`, role: 'user', content: message, incidentId },
        {
          id: `live-${exchange}-assistant`,
          role: 'assistant',
          content: '',
          incidentId,
          ...(replayFrom !== undefined
            ? { notice: 'This is a new version. Existing saved chats are unchanged.' }
            : {}),
        },
      ]);
      if (replayFrom !== undefined) setConversationId(undefined);
      setEditIndex(null);
      setShowHistory(false);
      setActionOutcome(null);
      atBottomRef.current = true;
      setUnread(false);
      setInput('');
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;
      const patch = (update: (turn: Turn) => Turn) => {
        if (seq !== requestSeq.current) return;
        if (!atBottomRef.current) setUnread(true);
        setTurns(current =>
          current.map((turn, index) => (index === current.length - 1 ? update(turn) : turn))
        );
      };
      try {
        const payload = {
          message,
          history,
          ...(incidentId ? { incidentId } : {}),
          ...(pageContext ? { pageContext } : {}),
          ...(conversationId && replayFrom === undefined ? { conversationId } : {}),
        };
        // Bound the serialized UTF-8 request, including integrity proofs and multibyte text.
        while (
          payload.history.length &&
          new TextEncoder().encode(JSON.stringify(payload)).byteLength > 60_000
        )
          payload.history.shift();
        const response = await fetch('/api/intelligence/squire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          patch(turn => ({
            ...turn,
            failed: true,
            content:
              response.status === 401
                ? 'Please sign in again.'
                : response.status === 429
                  ? 'Too many requests. Wait a moment, then retry.'
                  : response.status === 403
                    ? 'You do not have permission to use this assistant.'
                    : 'I could not answer that. Please try again.',
          }));
          // A request limit is only an AI limit when AI is on; in basic mode the status stays truthful.
          if (response.status === 429 && aiEnabled) setAvailability('quota');
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let completed = false;
        let reportedError = false;
        const processLine = (raw: string) => {
          const line = raw.trim();
          if (!line) return;
          let event: {
            type: string;
            text?: string;
            message?: string;
            label?: string;
            mode?: 'ai' | 'basic';
            intent?: string;
            availability?: AiAvailability;
            attention?: boolean;
            id?: string;
            userProof?: string;
            assistantProof?: string;
            proposal?: SquireProposalView;
            items?: unknown[];
          };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (seq !== requestSeq.current) return;
          if (
            event.availability &&
            ['ready', 'disabled', 'quota', 'unavailable'].includes(event.availability)
          )
            setAvailability(event.availability);
          if (event.type === 'meta') setAttention(event.attention === true);
          if (event.type === 'done') {
            completed = true;
            return;
          }
          if (event.type === 'context') {
            if (seq === requestSeq.current)
              setTurns(current =>
                current.map((turn, index) =>
                  index === current.length - 1 && event.assistantProof
                    ? { ...turn, contextProof: event.assistantProof }
                    : index === current.length - 2 && event.userProof
                      ? { ...turn, contextProof: event.userProof }
                      : turn
                )
              );
            return;
          }
          if (event.type === 'error') reportedError = true;
          if (event.type === 'delta' && event.text)
            patch(turn => ({ ...turn, content: turn.content + event.text, activity: undefined }));
          else if (event.type === 'meta' && event.mode)
            patch(turn => ({
              ...turn,
              mode: event.mode,
              ...(typeof event.intent === 'string' ? { intent: event.intent } : {}),
            }));
          else if (event.type === 'tool' && event.label)
            patch(turn => ({ ...turn, activity: event.label }));
          else if (event.type === 'proposal' && event.proposal)
            patch(turn => ({
              ...turn,
              activity: undefined,
              proposals: [...(turn.proposals ?? []), event.proposal!],
            }));
          else if (event.type === 'citations' && Array.isArray(event.items))
            patch(turn => ({ ...turn, citations: event.items as Citation[] }));
          else if (event.type === 'suggestions' && Array.isArray(event.items))
            patch(turn => ({
              ...turn,
              suggestions: (event.items as unknown[]).filter(
                (item): item is string => typeof item === 'string'
              ),
            }));
          else if (event.type === 'notice' && event.text)
            patch(turn => ({ ...turn, notice: event.text }));
          else if (event.type === 'conversation' && event.id) {
            if (seq === requestSeq.current) setConversationId(event.id);
          } else if (event.type === 'error')
            // Keep what already arrived and say it was cut off, rather than hiding the failure.
            patch(turn =>
              turn.content
                ? {
                    ...turn,
                    activity: undefined,
                    failed: true,
                    error: event.message || 'The response was interrupted.',
                  }
                : {
                    ...turn,
                    activity: undefined,
                    failed: true,
                    content: event.message || 'Something went wrong.',
                  }
            );
        };
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
              processLine(buffer.slice(0, newline));
              buffer = buffer.slice(newline + 1);
              newline = buffer.indexOf('\n');
            }
          }
          buffer += decoder.decode();
          processLine(buffer);
          if (!completed && !reportedError) {
            patch(turn =>
              turn.content
                ? {
                    ...turn,
                    failed: true,
                    error: 'The response was interrupted. Please ask again to continue.',
                  }
                : {
                    ...turn,
                    failed: true,
                    content: 'The response was interrupted. Please try again.',
                  }
            );
          }
        } finally {
          reader.releaseLock?.();
        }
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          patch(turn => ({
            ...turn,
            failed: true,
            content: turn.content || 'I could not reach the server. Please try again.',
            ...(turn.content
              ? { error: 'The response was interrupted. Please ask again to continue.' }
              : {}),
          }));
        }
      } finally {
        patch(turn => ({ ...turn, activity: undefined }));
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [busy, conversationId, incidentId, pageContext, aiEnabled, turns, activeScope, online]
  );

  const retryAnswer = useCallback((index: number) => {
    const questionIndex = turnsRef.current
      .slice(0, index)
      .findLastIndex(turn => turn.role === 'user');
    if (questionIndex >= 0)
      void sendRef.current(turnsRef.current.at(questionIndex)!.content, questionIndex);
  }, []);
  const editQuestion = useCallback((index: number) => {
    const turn = turnsRef.current.at(index);
    if (!turn || turn.role !== 'user') return;
    setEditIndex(index);
    setInput(turn.content);
    inputRef.current?.focus();
  }, []);
  const jumpToLatest = () => {
    atBottomRef.current = true;
    setUnread(false);
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'instant' });
  };

  const stopResponse = () => {
    // Fence late chunks before aborting so they cannot replace the retained answer.
    requestSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns(current =>
      current.map((turn, index) =>
        index === current.length - 1 && turn.role === 'assistant'
          ? {
              ...turn,
              activity: undefined,
              notice: [turn.notice, 'Response stopped. You can ask a follow-up.']
                .filter(Boolean)
                .join(' '),
            }
          : turn
      )
    );
    setBusy(false);
    inputRef.current?.focus();
  };

  // A question asked while busy goes out as soon as the current answer is complete.
  useEffect(() => {
    if (busy || !pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    void send(next);
  }, [busy, send]);

  const stopCurrent = useCallback(() => {
    requestSeq.current += 1;
    abortRef.current?.abort();
    pendingRef.current = null;
    setBusy(false);
  }, []);

  const newChat = useCallback(() => {
    stopCurrent();
    setTurns([]);
    setInput('');
    setEditIndex(null);
    setActionOutcome(null);
    setAttention(false);
    setGreeting(true);
    atBottomRef.current = true;
    setUnread(false);
    setConversationId(undefined);
    setActiveScope(undefined);
    setShowHistory(false);
    inputRef.current?.focus();
  }, [stopCurrent]);

  const loadSaved = useCallback(async (cursor?: string) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch(
        cursor ? `${CONVERSATIONS_URL}?cursor=${encodeURIComponent(cursor)}` : CONVERSATIONS_URL,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as {
        data?: { conversations?: SavedConversation[]; nextCursor?: string | null };
      };
      const page = body.data?.conversations ?? [];
      setSaved(current =>
        cursor
          ? [...new Map([...(current ?? []), ...page].map(item => [item.id, item])).values()]
          : page
      );
      setHistoryCursor(body.data?.nextCursor ?? null);
    } catch {
      setHistoryError('Saved conversations could not be loaded.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const toggleHistory = useCallback(() => {
    if (!showHistory) void loadSaved();
    setShowHistory(!showHistory);
  }, [loadSaved, showHistory]);

  const openSaved = useCallback(
    async (id: string) => {
      setHistoryError('');
      try {
        const response = await fetch(`${CONVERSATIONS_URL}/${encodeURIComponent(id)}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          data?: {
            conversation?: {
              id: string;
              incidentId: string | null;
              messages: Array<{
                role: 'user' | 'assistant';
                content: string;
                contextProof?: string;
                notice?: string;
                envelope?: StoredTurnEnvelope;
              }>;
            };
          };
        };
        const conversation = body.data?.conversation;
        if (!conversation) throw new Error('missing');
        stopCurrent();
        setInput('');
        setEditIndex(null);
        setActionOutcome(null);
        setAttention(false);
        atBottomRef.current = true;
        setUnread(false);
        setTurns(
          conversation.messages.map(({ role, content, contextProof, notice, envelope }, index) => ({
            id: `${conversation.id}-${index}`,
            role,
            content,
            incidentId: conversation.incidentId ?? undefined,
            contextProof,
            ...(envelope?.mode === 'ai' || envelope?.mode === 'basic'
              ? { mode: envelope.mode }
              : {}),
            citations: envelope?.citations,
            savedActions: envelope?.actions,
            notice:
              [...new Set([...(envelope?.notices ?? []), ...(notice ? [notice] : [])])].join(' ') ||
              undefined,
          }))
        );
        setActiveScope(conversation.incidentId ?? null);
        setConversationId(conversation.id);
        setShowHistory(false);
      } catch {
        setHistoryError('That conversation could not be opened.');
      }
    },
    [stopCurrent]
  );

  const removeSaved = useCallback(
    async (id?: string) => {
      setHistoryError('');
      try {
        const response = await fetch(
          id ? `${CONVERSATIONS_URL}/${encodeURIComponent(id)}` : CONVERSATIONS_URL,
          { method: 'DELETE' }
        );
        if (!response.ok && response.status !== 404) throw new Error(String(response.status));
        if (!id || id === conversationId) {
          stopCurrent();
          setConversationId(undefined);
          setActiveScope(undefined);
          setTurns([]);
          setInput('');
        }
        setConfirmDeleteAll(false);
        await loadSaved();
      } catch {
        setHistoryError('Could not delete. Please try again.');
      }
    },
    [conversationId, loadSaved, stopCurrent]
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input, editIndex ?? undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input, editIndex ?? undefined);
    }
  };

  const suggestions = incidentId
    ? [...INCIDENT_SUGGESTIONS, 'Who is assigned to this incident?', 'Help']
    : SUGGESTIONS;

  return (
    <div
      className={`fixed z-40 print:hidden ${open ? 'inset-0 sm:inset-auto sm:bottom-4' : 'bottom-4'} ${side === 'left' ? 'left-0 sm:left-4' : 'right-0 sm:right-4'}`}
      data-side={side}
    >
      {!open && launcher === 'FLOATING' && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls={panelId}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-lg transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <SquireAvatar
            kind={avatar}
            animated={animated}
            state={busy || !online ? mascotState : incidentAttention ? 'alert' : 'idle'}
          />
          <span>Ask {name}</span>
        </button>
      )}
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-label={`${name}, your incident assistant`}
          onKeyDown={event => event.key === 'Escape' && close()}
          className={`relative flex h-[100dvh] w-screen min-w-0 flex-col overflow-hidden bg-card shadow-2xl sm:h-[min(52rem,calc(100dvh-2rem))] sm:rounded-2xl sm:border sm:border-border ${expanded ? 'sm:w-[min(52rem,calc(100vw-2rem))]' : 'sm:w-[min(34rem,calc(100vw-2rem))]'}`}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <SquireAvatar kind={avatar} size="md" animated={animated} state={mascotState} />
              <div className="min-w-0">
                <h2 className="truncate font-display text-base font-semibold">{name}</h2>
                <p
                  className="mt-0.5 truncate text-[11px] text-muted-foreground"
                  title={presence.label}
                >
                  {statusLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="hidden min-h-11 min-w-11 sm:inline-flex"
                onClick={() => setExpanded(value => !value)}
                aria-label={expanded ? 'Narrow chat' : 'Expand chat'}
              >
                {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              </Button>
              {(turns.length > 0 || showHistory) && (
                <button
                  type="button"
                  onClick={newChat}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">New chat</span>
                </button>
              )}
              {history && (
                <button
                  type="button"
                  onClick={toggleHistory}
                  aria-pressed={showHistory}
                  aria-label="Saved conversations"
                  title="Saved conversations"
                  className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-accent"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={switchSide}
                aria-label={`Move ${name} to the ${side === 'right' ? 'left' : 'right'} side`}
                title="Move to the other side"
                className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-accent"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label={`Close ${name}`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-accent"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          {actionOutcome && (
            <div
              role="status"
              className="flex items-center gap-3 border-b border-border bg-muted/20 px-4 py-2"
            >
              <OpsKnightSquire state={actionOutcome} size={56} animated={animated} label="" />
              <p className="text-sm">
                {actionOutcome === 'success'
                  ? 'Your confirmed action completed.'
                  : 'The action could not be completed. Review the result below.'}
              </p>
            </div>
          )}
          {!showHistory && !contextMismatch && mascotState === 'alert' && (
            <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
              <OpsKnightSquire state="alert" size={56} animated={animated} label="" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">High urgency needs attention</p>
                <Button
                  variant="link"
                  size="sm"
                  className="min-h-11 px-0 text-xs"
                  onClick={() =>
                    void send(
                      incidentId
                        ? 'Summarise this incident and suggest next steps'
                        : 'What is on fire?'
                    )
                  }
                >
                  Review the evidence
                </Button>
              </div>
            </div>
          )}
          {!showHistory && contextMismatch && (
            <div
              role="status"
              className="border-b border-border bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <p>This chat keeps its original context. Choose where to continue.</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Link
                  href={
                    activeScope ? `/incidents/${encodeURIComponent(activeScope)}` : '/incidents'
                  }
                  className="underline underline-offset-2"
                >
                  Return to original context
                </Link>
                <button
                  type="button"
                  onClick={newChat}
                  className="min-h-8 rounded border border-current px-2 py-1"
                >
                  New chat here
                </button>
              </div>
            </div>
          )}
          {!showHistory && !contextMismatch && (
            <p className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
              <span>{incidentId ? 'Discussing this incident' : 'General conversation'}</span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${availability === 'ready' ? 'bg-emerald-500' : 'bg-muted-foreground'}`}
                />
                {availability === 'ready' ? 'AI enabled' : 'Basic mode'}
              </span>
            </p>
          )}
          {showHistory && history ? (
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
              <label className="flex items-center gap-2 rounded-xl border border-border px-3">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  aria-label="Search loaded conversations"
                  placeholder="Search loaded chats…"
                  className="min-h-11 min-w-0 flex-1 bg-transparent outline-none"
                  value={historySearch}
                  onChange={event => setHistorySearch(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Only you can see these. They are deleted after {history.retentionDays}{' '}
                {history.retentionDays === 1 ? 'day' : 'days'} after the last message. Reading them
                does not reset this period.
              </p>
              {historyError && (
                <p role="alert" className="text-xs text-destructive">
                  {historyError}
                </p>
              )}
              {historyError && (
                <button
                  type="button"
                  disabled={historyLoading}
                  onClick={() => void loadSaved()}
                  className="min-h-11 underline"
                >
                  Retry history
                </button>
              )}
              {saved === null && !historyError && <p className="text-muted-foreground">Loading…</p>}
              {saved?.length === 0 && (
                <p className="text-muted-foreground">
                  {historyCursor
                    ? 'No readable chats on this page. Load older chats to continue.'
                    : 'No saved conversations yet.'}
                </p>
              )}
              {saved && saved.length > 0 && (
                <>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {saved
                      .filter(item =>
                        item.title.toLowerCase().includes(historySearch.toLowerCase().trim())
                      )
                      .map(item => (
                        <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => void openSaved(item.id)}
                            className="min-h-11 min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-accent"
                          >
                            <span className="block truncate">{item.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {formatDateTime(item.updatedAt, userTimeZone, {
                                includeTimeZone: true,
                              })}{' '}
                              · {item.messageCount} messages
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeSaved(item.id)}
                            aria-label={`Delete conversation: ${item.title}`}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                  </ul>
                  {confirmDeleteAll ? (
                    <div
                      role="group"
                      aria-label="Confirm deleting all saved conversations"
                      className="flex items-center gap-3 text-xs"
                    >
                      <span>Delete all of them?</span>
                      <button
                        type="button"
                        onClick={() => void removeSaved()}
                        className="font-medium text-destructive hover:underline"
                      >
                        Delete all
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAll(false)}
                        className="hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAll(true)}
                      className="text-xs text-destructive underline-offset-2 hover:underline"
                    >
                      Delete all saved conversations
                    </button>
                  )}
                </>
              )}
              {saved &&
                saved.length > 0 &&
                historySearch.trim() &&
                !saved.some(item =>
                  item.title.toLowerCase().includes(historySearch.toLowerCase().trim())
                ) && (
                  <p className="text-sm text-muted-foreground">
                    No matching chats on the loaded pages.
                  </p>
                )}
              {historyCursor && (
                <button
                  type="button"
                  disabled={historyLoading}
                  onClick={() => void loadSaved(historyCursor)}
                  className="min-h-11 w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {historyLoading ? 'Loading older chats…' : 'Load older chats'}
                </button>
              )}
            </div>
          ) : (
            <div
              ref={scrollRef}
              role="log"
              aria-label="Conversation"
              aria-live="off"
              aria-busy={busy}
              onScroll={event => {
                const el = event.currentTarget;
                atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
                if (atBottomRef.current) setUnread(false);
              }}
              className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-5 text-sm sm:px-6"
            >
              {turns.length === 0 && (
                <div className="space-y-3">
                  {avatar === 'SQUIRE' && (
                    <div className="flex justify-center py-2" aria-hidden="true">
                      <OpsKnightSquire state={mascotState} size={96} animated={animated} label="" />
                    </div>
                  )}
                  <div className="text-center">
                    <h3 className="font-display text-xl font-semibold tracking-tight">
                      What are we investigating?
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">Hi, I&apos;m {name}.</p>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Check incidents, service ownership, on-call coverage, runbooks and follow-up
                    work with recorded evidence.
                    {aiEnabled
                      ? ' Actions always need your confirmation.'
                      : ' AI is off; live data and built-in investigation guidance are still available.'}
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    {suggestions.map(suggestion => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void send(suggestion)}
                        aria-label={suggestion}
                        className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-left text-xs leading-5 transition-colors hover:border-primary/40 hover:bg-accent"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((turn, index) => (
                <SquireMessage
                  key={turn.id ?? index}
                  turn={turn}
                  index={index}
                  name={name}
                  busy={busy && index === turns.length - 1}
                  last={index === turns.length - 1}
                  animated={animated}
                  contextValid={!contextMismatch}
                  onOutcome={setActionOutcome}
                  onRetry={retryAnswer}
                  onEdit={editQuestion}
                  question={index > 0 ? turns[index - 1]?.content : undefined}
                  conversationId={conversationId}
                />
              ))}
              {!busy && (turns.at(-1)?.suggestions?.length ?? 0) > 0 && (
                <div aria-label="Suggested questions" className="flex flex-wrap gap-2">
                  {turns.at(-1)!.suggestions!.map(suggestion => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-left text-xs leading-5 transition-colors hover:border-primary/40 hover:bg-accent"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}

          <div className="sr-only" role="status" aria-live="polite">
            {busy ? 'Response in progress' : turns.length > 0 ? 'Answer complete' : ''}
          </div>
          {!showHistory && unread && (
            <div className="absolute bottom-40 left-0 right-0 flex justify-center pointer-events-none">
              <Button
                variant="outline"
                size="sm"
                className="pointer-events-auto min-h-11 rounded-full bg-card shadow-md"
                onClick={jumpToLatest}
              >
                <ArrowDown aria-hidden="true" />
                Jump to latest
              </Button>
            </div>
          )}
          {!online && (
            <p role="status" className="border-t border-border bg-muted/40 px-4 py-2 text-xs">
              You are offline. Your draft is kept here. Reconnect to send a message.
            </p>
          )}
          <form
            onSubmit={onSubmit}
            className="shrink-0 border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
          >
            {editIndex !== null && (
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Editing a question starts a new version of this chat.</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditIndex(null);
                    setInput('');
                  }}
                >
                  Cancel edit
                </Button>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
              <label htmlFor={`${panelId}-input`} className="sr-only">
                Message {name}
              </label>
              <Textarea
                id={`${panelId}-input`}
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                maxLength={MAX_LENGTH}
                rows={1}
                placeholder={
                  contextMismatch
                    ? 'Choose where to continue…'
                    : incidentId
                      ? 'Ask about this incident…'
                      : 'Ask a question…'
                }
                className="max-h-40 min-h-11 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <div className="flex items-center justify-between gap-2 pl-2">
                <span className="text-[10px] text-muted-foreground">
                  <span className="hidden sm:inline">
                    Enter to send · Shift + Enter for a new line
                  </span>
                  <span className="sm:hidden">
                    {input.length}/{MAX_LENGTH}
                  </span>
                </span>
                {busy ? (
                  <Button
                    type="button"
                    onClick={stopResponse}
                    aria-label="Stop response"
                    variant="secondary"
                    size="icon"
                    className="min-h-11 min-w-11 rounded-xl"
                  >
                    <Square aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={!online || contextMismatch || input.trim().length === 0}
                    aria-label="Send"
                    size="icon"
                    className="min-h-11 min-w-11 rounded-xl"
                  >
                    <Send aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 flex items-start justify-center gap-1.5 px-1 text-center text-[10px] leading-4 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {history
                ? `Private to you · saved for ${history.retentionDays} days. `
                : 'History is off. '}
              Review evidence before acting.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
