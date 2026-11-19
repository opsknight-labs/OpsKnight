'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { roleLabel } from '@/lib/authorization';
import { useAccess } from '@/components/access/AccessProvider';
import { revokeAccessGrantAction } from '@/app/(app)/settings/access/actions';

function remaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return 'ending now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m left`;
  return `${Math.floor(hours / 24)} days left`;
}

/**
 * Always-visible banner while someone holds elevated temporary access, so elevation is never
 * silent. Break-glass access is highlighted and can be ended early.
 */
export default function ElevatedAccessBanner() {
  const { snapshot } = useAccess();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const grants = (snapshot?.grants ?? []).filter(
    grant => grant.role && new Date(grant.expiresAt).getTime() > now
  );
  useEffect(() => {
    const next = Math.min(...grants.map(grant => new Date(grant.expiresAt).getTime()));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => router.refresh(), Math.max(next - Date.now(), 0) + 1_000);
    return () => clearTimeout(timer);
  }, [grants, router]);

  if (grants.length === 0) return null;
  const grant = grants[0];
  const breakGlass = grant.source === 'BREAK_GLASS';

  return (
    <div
      role="status"
      className={
        breakGlass
          ? 'flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100'
          : 'flex flex-wrap items-center gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100'
      }
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {breakGlass ? 'Emergency access: ' : 'Temporary access: '}
        <strong>{roleLabel(grant.role!)}</strong>
        {grant.incidentId ? ' for one incident' : ''} · {remaining(grant.expiresAt, now)}
        {breakGlass ? ' · Administrators were notified and actions are audited.' : ''}
      </span>
      <button
        type="button"
        disabled={pending}
        className="ml-auto rounded-md border border-current/30 px-2 py-0.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() =>
          startTransition(async () => {
            await revokeAccessGrantAction(grant.id, 'Ended early by holder');
            router.refresh();
          })
        }
      >
        {pending ? 'Ending…' : 'End now'}
      </button>
    </div>
  );
}
