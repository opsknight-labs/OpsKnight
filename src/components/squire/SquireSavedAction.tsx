'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SavedActionReference } from '@/lib/intelligence/conversations/contract';

/** A historical reference can check an outcome, but has no confirmation token or write control. */
export default function SquireSavedAction({ action }: { action: SavedActionReference }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const response = await fetch(
        `/api/intelligence/squire/actions/${encodeURIComponent(action.receiptId)}`,
        { cache: 'no-store' }
      );
      const body = (await response.json()) as { data?: { outcome?: { message: string } } };
      setMessage(
        response.ok && body.data?.outcome
          ? body.data.outcome.message
          : 'No result is available. Review the incident; this suggestion cannot be confirmed from history.'
      );
    } catch {
      setMessage(
        'The result could not be checked. Try checking again; no action will be repeated.'
      );
    } finally {
      setChecking(false);
    }
  };
  return (
    <div
      role="group"
      aria-label={`Saved action: ${action.title}`}
      className="mt-2 rounded-md border border-border bg-card p-3 text-xs"
    >
      <p className="font-medium">{action.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href={`/incidents/${encodeURIComponent(action.incidentId)}`}
          className="text-primary underline underline-offset-2"
        >
          View incident
        </Link>
        <button
          type="button"
          disabled={checking}
          onClick={() => void check()}
          className="min-h-8 rounded border border-border px-3 py-1 hover:bg-accent disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Check result'}
        </button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-foreground/80">
          {message}
        </p>
      )}
    </div>
  );
}
