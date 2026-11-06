'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';

export type SquireProposalView = {
  token: string;
  receiptId?: string;
  action: string;
  kind: 'WRITE' | 'NAVIGATE';
  title: string;
  detail: string;
  incidentId: string;
  expiresAt: string;
  href?: string;
};

type State =
  | { phase: 'idle' | 'running' | 'recovering' | 'dismissed' }
  | { phase: 'done' | 'failed' | 'unknown'; message: string };

/**
 * One suggested action. Nothing has happened until the person presses Confirm; then the server runs it under
 * their own permissions and reports back. Navigation suggestions are plain links into the existing pages.
 */
export default function SquireProposalCard({
  proposal,
  reviewContextValid = true,
  onOutcome,
}: {
  proposal: SquireProposalView;
  reviewContextValid?: boolean;
  onOutcome?: (outcome: 'success' | 'error') => void;
}) {
  const { refresh } = useRouter();
  const attempted = useRef(false);
  const [state, setState] = useState<State>(() => ({
    phase: proposal.receiptId && proposal.kind === 'WRITE' ? 'recovering' : 'idle',
  }));
  const expiresAt = Date.parse(proposal.expiresAt);
  const [clock, setClock] = useState(() => Date.now());
  const expired = !Number.isFinite(expiresAt) || expiresAt <= clock;

  useEffect(() => {
    const remaining = Date.parse(proposal.expiresAt) - Date.now();
    const delay = Number.isFinite(remaining) ? Math.max(0, Math.min(remaining, 2_147_483_647)) : 0;
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [proposal.expiresAt]);

  const checkResult = useCallback(
    async (signal?: AbortSignal) => {
      if (!proposal.receiptId) return;
      try {
        const response = await fetch(
          `/api/intelligence/squire/actions/${encodeURIComponent(proposal.receiptId)}`,
          {
            cache: 'no-store',
            signal,
          }
        );
        if (signal?.aborted) return;
        if (response.status === 404) {
          setState(
            !attempted.current
              ? { phase: 'idle' }
              : {
                  phase: 'unknown',
                  message:
                    'The result is not available. Check the incident before requesting another action.',
                }
          );
          return;
        }
        const body = (await response.json()) as {
          data?: { outcome?: { status: string; message: string } };
        };
        if (signal?.aborted) return;
        const outcome = body.data?.outcome;
        if (!response.ok || !outcome) throw new Error('Outcome unavailable');
        attempted.current = true;
        setState({
          phase:
            outcome.status === 'SUCCEEDED'
              ? 'done'
              : outcome.status === 'FAILED'
                ? 'failed'
                : 'unknown',
          message: outcome.message,
        });
        if (outcome.status === 'SUCCEEDED') refresh();
      } catch {
        if (!signal?.aborted)
          setState({
            phase: 'unknown',
            message:
              'Could not check the result. Check again before requesting another action; this attempt will not be resubmitted.',
          });
      }
    },
    [proposal.receiptId, refresh]
  );

  useEffect(() => {
    if (!proposal.receiptId || proposal.kind !== 'WRITE') return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void checkResult(controller.signal);
    });
    return () => controller.abort();
  }, [checkResult, proposal.receiptId, proposal.kind]);

  if (state.phase === 'dismissed') return null;

  const confirm = async () => {
    if (
      !reviewContextValid ||
      state.phase !== 'idle' ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      setClock(Date.now());
      return;
    }
    attempted.current = true;
    setState({ phase: 'running' });
    try {
      const response = await fetch('/api/intelligence/squire/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: proposal.token }),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;
      if (response.ok && body?.ok) {
        onOutcome?.('success');
        setState({ phase: 'done', message: body.message ?? 'Done.' });
        refresh();
      } else {
        onOutcome?.('error');
        setState({
          phase: 'failed',
          message:
            body?.message ??
            body?.error ??
            'The action could not be confirmed. Refresh the incident before trying again.',
        });
      }
    } catch {
      onOutcome?.('error');
      setState({
        phase: 'failed',
        message:
          'Could not confirm the result. Refresh the incident before requesting another action.',
      });
    }
  };

  return (
    <div
      role="group"
      aria-label={`Suggested action: ${proposal.title}`}
      className="mt-2 rounded-md border border-border bg-card p-3 text-foreground"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Suggested action
      </p>
      <p className="mt-1 font-medium">{proposal.title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground/80">
        {proposal.detail}
      </p>
      <Link
        href={`/incidents/${encodeURIComponent(proposal.incidentId)}`}
        className="mt-2 inline-block text-xs font-medium text-primary underline underline-offset-2"
      >
        View incident
      </Link>
      {state.phase === 'done' || state.phase === 'failed' || state.phase === 'unknown' ? (
        <div>
          <p
            role="status"
            className={`mt-2 text-xs font-medium ${state.phase === 'done' ? 'text-emerald-700 dark:text-emerald-400' : state.phase === 'unknown' ? 'text-amber-700 dark:text-amber-400' : 'text-destructive'}`}
          >
            {state.message}
          </p>
          {state.phase !== 'done' && proposal.receiptId && (
            <button
              type="button"
              className="mt-2 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
              onClick={() => {
                setState({ phase: 'recovering' });
                void checkResult();
              }}
            >
              Check result
            </button>
          )}
        </div>
      ) : proposal.kind === 'NAVIGATE' && proposal.href ? (
        <div className="mt-2 flex items-center gap-2">
          <Link
            href={proposal.href}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open
          </Link>
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            className="rounded-md px-3 py-1.5 text-xs hover:bg-accent"
          >
            Dismiss
          </button>
        </div>
      ) : !reviewContextValid && state.phase === 'idle' ? (
        <p role="status" className="mt-2 text-xs text-foreground/80">
          Return to the original conversation context before confirming this suggestion.
        </p>
      ) : expired && state.phase === 'idle' ? (
        <div className="mt-2 space-y-2">
          <p role="status" className="text-xs text-foreground/80">
            This suggestion has expired. Ask Squire for a fresh one.
          </p>
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            className="rounded-md px-3 py-1.5 text-xs hover:bg-accent"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={state.phase === 'running' || state.phase === 'recovering'}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {state.phase === 'recovering'
              ? 'Checking result…'
              : state.phase === 'running'
                ? 'Working…'
                : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            disabled={state.phase === 'running' || state.phase === 'recovering'}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Dismiss
          </button>
          <time dateTime={proposal.expiresAt} className="w-full text-xs text-muted-foreground">
            Confirm before{' '}
            {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
      )}
    </div>
  );
}
