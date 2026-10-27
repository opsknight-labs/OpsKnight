'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Sparkles, X } from 'lucide-react';

type Turn = { role: 'user' | 'assistant'; content: string; notice?: string; mode?: 'ai' | 'basic' };

const HISTORY_TURNS = 10;
const MAX_LENGTH = 2000;
const INTERNAL_LINK = /(\/(?:incidents|runbooks)\/[A-Za-z0-9_-]{1,64})/g;
const SUGGESTIONS = ['What is on fire?', 'Help'];
const INCIDENT_SUGGESTIONS = ['Similar incidents?', 'What could have caused this?', 'Which runbook fits?'];

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

export default function SquireLauncher({ name }: { name: string }) {
  const pathname = usePathname();
  const incidentId = incidentIdFrom(pathname);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    setOpen(false);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.squireName = name;
    window.dispatchEvent(new Event('squire:ready'));
    return () => {
      delete document.documentElement.dataset.squireName;
      window.dispatchEvent(new Event('squire:ready'));
    };
  }, [name]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('squire:open', onOpen);
    return () => window.removeEventListener('squire:open', onOpen);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim().slice(0, MAX_LENGTH);
      if (!message || busy) return;
      const history = turns.filter(turn => turn.content).slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
      setTurns(current => [...current, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
      setInput('');
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (update: (turn: Turn) => Turn) =>
        setTurns(current => current.map((turn, index) => (index === current.length - 1 ? update(turn) : turn)));
      try {
        const response = await fetch('/api/intelligence/squire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history, ...(incidentId ? { incidentId } : {}) }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          patch(turn => ({ ...turn, content: response.status === 401 ? 'Please sign in again.' : 'I could not answer that. Please try again.' }));
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
            let event: { type: string; text?: string; message?: string; mode?: 'ai' | 'basic' };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            if (event.type === 'delta' && event.text) patch(turn => ({ ...turn, content: turn.content + event.text }));
            else if (event.type === 'meta' && event.mode) patch(turn => ({ ...turn, mode: event.mode }));
            else if (event.type === 'notice' && event.text) patch(turn => ({ ...turn, notice: event.text }));
            else if (event.type === 'error') patch(turn => ({ ...turn, content: turn.content || event.message || 'Something went wrong.' }));
          }
        }
      } catch (error) {
        if ((error as { name?: string }).name !== 'AbortError') {
          patch(turn => ({ ...turn, content: turn.content || 'I could not reach the server. Please try again.' }));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, incidentId, turns]
  );

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
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls={panelId}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-lg transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
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
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-sm font-semibold">{name}</h2>
            </div>
            <div className="flex items-center gap-1">
              {turns.length > 0 && (
                <button type="button" onClick={() => setTurns([])} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
                  New chat
                </button>
              )}
              <button type="button" onClick={close} aria-label={`Close ${name}`} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite" aria-busy={busy}>
            {turns.length === 0 && (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  Hi, I&apos;m {name}. I can look through the incidents you can access and suggest what to check. I never change anything.
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
              <div key={index} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 ${
                    turn.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  {turn.notice && <p className="mb-1 text-xs text-muted-foreground">{turn.notice}</p>}
                  {turn.content ? <RichText text={turn.content} /> : busy && index === turns.length - 1 ? <span className="text-muted-foreground">Thinking…</span> : null}
                  {turn.role === 'assistant' && turn.mode === 'basic' && turn.content && (
                    <p className="mt-1 text-[11px] text-muted-foreground">Basic answer from your incident data</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

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
