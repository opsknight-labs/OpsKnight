'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowLeftRight, History, Send, Trash2, X } from 'lucide-react';
import SquireAvatar, { type SquireAvatarKind } from '@/components/squire/SquireAvatar';
import SquireProposalCard, {
  type SquireProposalView,
} from '@/components/squire/SquireProposalCard';

type Citation = {
  kind: 'incident' | 'runbook' | 'change' | 'alert';
  id: string;
  label: string;
  href: string;
};
type Turn = {
  role: 'user' | 'assistant';
  content: string;
  notice?: string;
  mode?: 'ai' | 'basic';
  /** What the assistant is looking up right now. */
  activity?: string;
  /** Shown after partial text when the answer was cut off. */
  error?: string;
  proposals?: SquireProposalView[];
  citations?: Citation[];
  suggestions?: string[];
  /** The incident page the turn was asked on; history only carries turns from the same page. */
  incidentId?: string;
};
type SavedConversation = { id: string; title: string; updatedAt: string; messageCount: number };
const CONVERSATIONS_URL = '/api/intelligence/squire/conversations';

const HISTORY_TURNS = 10;
const MAX_LENGTH = 2000;
/** The server keeps this much of each earlier turn as context; sending more only wastes the request. */
const HISTORY_TURN_LENGTH = 4000;
const INTERNAL_LINK = /(\/(?:incidents|runbooks)\/[A-Za-z0-9_-]{1,64})/g;
const SUGGESTIONS = ['What is on fire?', 'Help'];
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

/** Other parts of the UI open the assistant, optionally with a question, by dispatching this event. */
// A request made before the launcher has mounted (a fast click on a slow page) is kept here, not lost.
let queuedOpen: { message?: string } | null = null;
let launcherListening = false;

export function openSquire(message?: string) {
  const detail = message ? { message } : undefined;
  if (!launcherListening) queuedOpen = detail ?? {};
  window.dispatchEvent(new CustomEvent('squire:open', { detail }));
}

/** Only same-app paths become links; everything else stays inert text. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(INTERNAL_LINK).map((part, index) =>
        index % 2 === 1 ? (
          <Link key={index} href={part} className="underline underline-offset-2">
            {part}
          </Link>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}

function incidentIdFrom(pathname: string | null): string | undefined {
  const match = pathname?.match(/^\/incidents\/([A-Za-z0-9_-]{1,64})(?:\/|$)/);
  return match && match[1] !== 'new' ? match[1] : undefined;
}

export default function SquireLauncher({
  name,
  avatar = 'ICON',
  launcher = 'FLOATING',
  animated = false,
  history = null,
}: {
  name: string;
  avatar?: SquireAvatarKind;
  launcher?: 'FLOATING' | 'SEARCH_ONLY';
  animated?: boolean;
  /** Set when an administrator has turned on saved conversations. */
  history?: { retentionDays: number } | null;
}) {
  const pathname = usePathname();
  const side = useSyncExternalStore(subscribeSide, readSide, serverSide);
  const sendRef = useRef<(message: string) => Promise<void>>(async () => undefined);
  const incidentId = incidentIdFrom(pathname);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [saved, setSaved] = useState<SavedConversation[] | null>(null);
  const [historyError, setHistoryError] = useState('');
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
    window.addEventListener('squire:open', onOpen);
    launcherListening = true;
    // Replay a queued request once the rest of this render's effects (including sendRef) have run.
    const queued = queuedOpen;
    queuedOpen = null;
    const replay = queued
      ? window.setTimeout(() => onOpen(new CustomEvent('squire:open', { detail: queued })))
      : undefined;
    return () => {
      launcherListening = false;
      if (replay !== undefined) window.clearTimeout(replay);
      window.removeEventListener('squire:open', onOpen);
    };
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
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim().slice(0, MAX_LENGTH);
      if (!message) return;
      if (busy) {
        // Asked while an answer is still arriving (for example from another part of the page): send it next.
        pendingRef.current = message;
        return;
      }
      const history = turns
        .filter(turn => turn.content && turn.incidentId === incidentId)
        .slice(-HISTORY_TURNS)
        .map(({ role, content }) => ({ role, content: content.slice(0, HISTORY_TURN_LENGTH) }));
      setTurns(current => [
        ...current,
        { role: 'user', content: message, incidentId },
        { role: 'assistant', content: '', incidentId },
      ]);
      setInput('');
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;
      const patch = (update: (turn: Turn) => Turn) => {
        if (seq !== requestSeq.current) return;
        setTurns(current =>
          current.map((turn, index) => (index === current.length - 1 ? update(turn) : turn))
        );
      };
      try {
        const response = await fetch('/api/intelligence/squire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            history,
            ...(incidentId ? { incidentId } : {}),
            ...(conversationId ? { conversationId } : {}),
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          patch(turn => ({
            ...turn,
            content:
              response.status === 401
                ? 'Please sign in again.'
                : 'I could not answer that. Please try again.',
          }));
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
            if (!line) continue;
            let event: {
              type: string;
              text?: string;
              message?: string;
              label?: string;
              mode?: 'ai' | 'basic';
              id?: string;
              proposal?: SquireProposalView;
              items?: unknown[];
            };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.type === 'delta' && event.text)
              patch(turn => ({ ...turn, content: turn.content + event.text, activity: undefined }));
            else if (event.type === 'meta' && event.mode)
              patch(turn => ({ ...turn, mode: event.mode }));
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
                      error: event.message || 'The response was interrupted.',
                    }
                  : {
                      ...turn,
                      activity: undefined,
                      content: event.message || 'Something went wrong.',
                    }
              );
          }
        }
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          patch(turn => ({
            ...turn,
            content: turn.content || 'I could not reach the server. Please try again.',
          }));
        }
      } finally {
        patch(turn => ({ ...turn, activity: undefined }));
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [busy, conversationId, incidentId, turns]
  );

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
    setConversationId(undefined);
    setShowHistory(false);
  }, [stopCurrent]);

  const loadSaved = useCallback(async () => {
    setHistoryError('');
    try {
      const response = await fetch(CONVERSATIONS_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { data?: { conversations?: SavedConversation[] } };
      setSaved(body.data?.conversations ?? []);
    } catch {
      setHistoryError('Saved conversations could not be loaded.');
    }
  }, []);

  const toggleHistory = useCallback(() => {
    setShowHistory(current => {
      if (!current) void loadSaved();
      return !current;
    });
  }, [loadSaved]);

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
              messages: Array<{ role: 'user' | 'assistant'; content: string }>;
            };
          };
        };
        const conversation = body.data?.conversation;
        if (!conversation) throw new Error('missing');
        stopCurrent();
        setTurns(conversation.messages.map(({ role, content }) => ({ role, content, incidentId })));
        setConversationId(conversation.id);
        setShowHistory(false);
      } catch {
        setHistoryError('That conversation could not be opened.');
      }
    },
    [incidentId, stopCurrent]
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
        if (!id || id === conversationId) setConversationId(undefined);
        setConfirmDeleteAll(false);
        await loadSaved();
      } catch {
        setHistoryError('Could not delete. Please try again.');
      }
    },
    [conversationId, loadSaved]
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  };

  const suggestions = incidentId ? [...INCIDENT_SUGGESTIONS, ...SUGGESTIONS] : SUGGESTIONS;

  return (
    <div
      className={`fixed bottom-4 z-40 print:hidden ${side === 'left' ? 'left-4' : 'right-4'}`}
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
          <SquireAvatar kind={avatar} animated={animated} />
          <span>Ask {name}</span>
        </button>
      )}
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-label={`${name}, your incident assistant`}
          onKeyDown={event => event.key === 'Escape' && close()}
          className="flex h-[min(32rem,70vh)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <SquireAvatar kind={avatar} size="md" />
              <h2 className="text-sm font-semibold">{name}</h2>
            </div>
            <div className="flex items-center gap-1">
              {(turns.length > 0 || showHistory) && (
                <button
                  type="button"
                  onClick={newChat}
                  className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  New chat
                </button>
              )}
              {history && (
                <button
                  type="button"
                  onClick={toggleHistory}
                  aria-pressed={showHistory}
                  aria-label="Saved conversations"
                  title="Saved conversations"
                  className="rounded p-1 hover:bg-accent"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={switchSide}
                aria-label={`Move ${name} to the ${side === 'right' ? 'left' : 'right'} side`}
                title="Move to the other side"
                className="rounded p-1 hover:bg-accent"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={close}
                aria-label={`Close ${name}`}
                className="rounded p-1 hover:bg-accent"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          {showHistory && history ? (
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Only you can see these. They are deleted after {history.retentionDays}{' '}
                {history.retentionDays === 1 ? 'day' : 'days'} without use.
              </p>
              {historyError && (
                <p role="alert" className="text-xs text-destructive">
                  {historyError}
                </p>
              )}
              {saved === null && !historyError && <p className="text-muted-foreground">Loading…</p>}
              {saved?.length === 0 && (
                <p className="text-muted-foreground">No saved conversations yet.</p>
              )}
              {saved && saved.length > 0 && (
                <>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {saved.map(item => (
                      <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => void openSaved(item.id)}
                          className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-accent"
                        >
                          <span className="block truncate">{item.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {new Date(item.updatedAt).toLocaleString()} · {item.messageCount}{' '}
                            messages
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeSaved(item.id)}
                          aria-label={`Delete conversation: ${item.title}`}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
            </div>
          ) : (
            <div
              className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
              aria-live="polite"
              aria-busy={busy}
            >
              {turns.length === 0 && (
                <div className="space-y-3">
                  <p className="text-muted-foreground">
                    Hi, I&apos;m {name}. I can look through the incidents you can access and suggest
                    what to check. I can also suggest actions; they only happen if you confirm them.
                    {history ? ' Our conversations are saved for you only.' : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map(suggestion => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void send(suggestion)}
                        className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((turn, index) => (
                <div
                  key={index}
                  className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 ${
                      turn.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    {turn.notice && (
                      <p className="mb-1 text-xs font-medium text-foreground/80">{turn.notice}</p>
                    )}
                    {turn.content ? (
                      <RichText text={turn.content} />
                    ) : busy && index === turns.length - 1 ? (
                      <span className="text-foreground/80">
                        {turn.activity ? `${turn.activity}…` : 'Thinking…'}
                      </span>
                    ) : null}
                    {turn.content && turn.activity && busy && index === turns.length - 1 && (
                      <p className="mt-1 text-xs text-foreground/80">{turn.activity}…</p>
                    )}
                    {turn.error && (
                      <p role="alert" className="mt-1 text-xs font-medium text-destructive">
                        {turn.error}
                      </p>
                    )}
                    {turn.proposals?.map(proposal => (
                      <SquireProposalCard key={proposal.token} proposal={proposal} />
                    ))}
                    {turn.citations && turn.citations.length > 0 && (
                      <ul aria-label="Sources" className="mt-2 flex flex-wrap gap-1">
                        {turn.citations.map(citation => (
                          <li key={`${citation.kind}:${citation.id}`}>
                            <Link
                              href={citation.href}
                              className="inline-block max-w-[14rem] truncate rounded-full border border-border bg-card px-2 py-0.5 text-xs hover:bg-accent"
                              title={citation.label}
                            >
                              {citation.kind === 'runbook' ? 'Runbook: ' : ''}
                              {citation.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {turn.role === 'assistant' && turn.mode === 'basic' && turn.content && (
                      <p className="mt-1 text-xs text-foreground/80">
                        Basic answer from your incident data
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {!busy && (turns.at(-1)?.suggestions?.length ?? 0) > 0 && (
                <div aria-label="Suggested questions" className="flex flex-wrap gap-2">
                  {turns.at(-1)!.suggestions!.map(suggestion => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}

          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border p-3">
            <label htmlFor={`${panelId}-input`} className="sr-only">
              Message {name}
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              maxLength={MAX_LENGTH}
              rows={1}
              placeholder={incidentId ? 'Ask about this incident…' : 'Ask a question…'}
              className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || input.trim().length === 0}
              aria-label="Send"
              className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
