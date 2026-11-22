'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { toneClasses } from '@/components/patterns/status-tone';

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
  /** The assistant read alerts, notes or other third-party text before suggesting this. */
  untrustedContext?: boolean;
  /** Server-written facts about exactly what will happen (extended actions). */
  preview?: Array<{ label: string; value: string }>;
  /** Server-chosen text for the confirm button. */
  confirmLabel?: string;
  /** Who or what the change reaches beyond this incident. */
  impact?: 'PAGES_PEOPLE' | 'EXTERNAL_SYSTEM' | 'PUBLIC' | 'AUTOMATION';
  /** Two-step flows, for example "Step 1 of 2". */
  step?: string;
};

const IMPACT_NOTICE: Record<NonNullable<SquireProposalView['impact']>, string> = {
  PAGES_PEOPLE: 'This notifies people right away.',
  EXTERNAL_SYSTEM: 'This sends incident details to another system.',
  PUBLIC: 'This is visible to anyone who can see the status page.',
  AUTOMATION: 'This starts automation. Its own approval steps still apply.',
};

// Bordered-card actions, right-aligned: 44 px on phones, compact in the desktop panel.
const PRIMARY =
  'inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:min-h-8';
const SECONDARY =
  'inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:min-h-8';

// The confirm handler reads the clock at click time; the compiler's purity check cannot tell it from render.
const nowMs = () => Date.now();

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
  // The second step of a two-step action (for example publishing a draft) is its own card and confirmation.
  const [followUp, setFollowUp] = useState<SquireProposalView | null>(null);
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
        const body = response.ok
          ? ((await response.json()) as {
              data?: {
                outcome?: {
                  status: string;
                  message: string;
                  result?: { followUp?: SquireProposalView };
                } | null;
              };
            })
          : null;
        if (signal?.aborted) return;
        // No result yet (200 with a null outcome; 404 for an id the server will not look up).
        if (response.status === 404 || (body && !body.data?.outcome)) {
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
        const outcome = body?.data?.outcome;
        if (!outcome) throw new Error('Outcome unavailable');
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
        if (outcome.status === 'SUCCEEDED' && outcome.result?.followUp)
          setFollowUp(outcome.result.followUp);
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
      expiresAt <= nowMs()
    ) {
      setClock(nowMs());
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
        followUp?: SquireProposalView;
      } | null;
      if (response.ok && body?.ok) {
        onOutcome?.('success');
        setState({ phase: 'done', message: body.message ?? 'Done.' });
        if (body.followUp) setFollowUp(body.followUp);
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
      className="space-y-2 rounded-xl border border-border bg-card p-3 text-foreground"
    >
      <div>
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">{proposal.title}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            Suggested action{proposal.step ? ` · ${proposal.step}` : ''}
          </span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {proposal.detail}
        </p>
      </div>
      {proposal.preview && proposal.preview.length > 0 && (
        <dl
          aria-label="What will happen"
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/50 p-2 text-xs"
        >
          {proposal.preview.map(item => (
            <div key={item.label} className="contents">
              <dt className="font-medium text-muted-foreground">{item.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {proposal.impact && (
        <p className="text-xs font-medium text-foreground">{IMPACT_NOTICE[proposal.impact]}</p>
      )}
      {proposal.untrustedContext && (
        <p className={`rounded-lg border p-2 text-xs ${toneClasses('elevated').soft}`}>
          Suggested after reading alerts, notes or other text written outside this conversation.
          Check that content yourself before confirming.
        </p>
      )}
      <Link
        href={`/incidents/${encodeURIComponent(proposal.incidentId)}`}
        className="inline-block text-xs font-medium text-foreground underline underline-offset-2"
      >
        View incident
      </Link>
      {state.phase === 'done' || state.phase === 'failed' || state.phase === 'unknown' ? (
        <div className="space-y-2">
          <p
            role="status"
            className={`text-xs font-medium ${toneClasses(state.phase === 'done' ? 'ok' : state.phase === 'unknown' ? 'elevated' : 'critical').text}`}
          >
            {state.message}
          </p>
          {state.phase === 'done' && followUp && (
            <SquireProposalCard proposal={followUp} onOutcome={onOutcome} />
          )}
          {state.phase !== 'done' && proposal.receiptId && (
            <button
              type="button"
              className={SECONDARY}
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
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            className={SECONDARY}
          >
            Dismiss
          </button>
          <Link href={proposal.href} className={PRIMARY}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open
          </Link>
        </div>
      ) : !reviewContextValid && state.phase === 'idle' ? (
        <p role="status" className="text-xs text-muted-foreground">
          Return to the original conversation context before confirming this suggestion.
        </p>
      ) : expired && state.phase === 'idle' ? (
        <div className="space-y-2">
          <p role="status" className="text-xs text-muted-foreground">
            This suggestion has expired. Ask Squire for a fresh one.
          </p>
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            className={SECONDARY}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <time dateTime={proposal.expiresAt} className="mr-auto text-xs text-muted-foreground">
            Confirm before{' '}
            {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            disabled={state.phase === 'running' || state.phase === 'recovering'}
            className={SECONDARY}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={state.phase === 'running' || state.phase === 'recovering'}
            className={PRIMARY}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {state.phase === 'recovering'
              ? 'Checking result…'
              : state.phase === 'running'
                ? 'Working…'
                : (proposal.confirmLabel ?? 'Confirm')}
          </button>
        </div>
      )}
    </div>
  );
}
