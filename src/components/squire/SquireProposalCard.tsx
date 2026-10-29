'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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

  if (state.phase === 'dismissed') return null;

  const confirm = async () => {
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
          message: body?.message ?? body?.error ?? 'That could not be done. Nothing was changed.',
        });
      }
    } catch {
      setState({ phase: 'failed', message: 'Could not reach the server. Nothing was changed.' });
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
      ) : (
        <div className="mt-2 flex items-center gap-2">
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
        </div>
      )}
    </div>
  );
}
