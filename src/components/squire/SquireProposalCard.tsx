'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';

export type SquireProposalView = {
  token: string;
  action: string;
  kind: 'WRITE' | 'NAVIGATE';
  title: string;
  detail: string;
  incidentId: string;
  expiresAt: string;
  href?: string;
};

type State =
  { phase: 'idle' | 'running' | 'dismissed' } | { phase: 'done' | 'failed'; message: string };

/**
 * One suggested action. Nothing has happened until the person presses Confirm; then the server runs it under
 * their own permissions and reports back. Navigation suggestions are plain links into the existing pages.
 */
export default function SquireProposalCard({ proposal }: { proposal: SquireProposalView }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: 'idle' });
  const expiresAt = Date.parse(proposal.expiresAt);
  const [clock, setClock] = useState(() => Date.now());
  const expired = !Number.isFinite(expiresAt) || expiresAt <= clock;

  useEffect(() => {
    const remaining = Date.parse(proposal.expiresAt) - Date.now();
    const delay = Number.isFinite(remaining) ? Math.max(0, Math.min(remaining, 2_147_483_647)) : 0;
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [proposal.expiresAt]);

  if (state.phase === 'dismissed') return null;

  const confirm = async () => {
    if (state.phase !== 'idle' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setClock(Date.now());
      return;
    }
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
        setState({ phase: 'done', message: body.message ?? 'Done.' });
        router.refresh();
      } else {
        setState({
          phase: 'failed',
          message:
            body?.message ??
            body?.error ??
            'The action could not be confirmed. Refresh the incident before trying again.',
        });
      }
    } catch {
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
      {state.phase === 'done' || state.phase === 'failed' ? (
        <p
          role="status"
          className={`mt-2 text-xs font-medium ${state.phase === 'done' ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}
        >
          {state.message}
        </p>
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
      ) : expired && state.phase !== 'running' ? (
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
            disabled={state.phase === 'running'}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {state.phase === 'running' ? 'Working…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setState({ phase: 'dismissed' })}
            disabled={state.phase === 'running'}
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
