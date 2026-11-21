import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { countInsightsInboxBadge } from '@/lib/intelligence/ops-insights/view';

/**
 * Topbar link to the "Needs attention" inbox with the open-insight count. An async server component for its
 * own Suspense boundary, so the shell never waits on it. Renders nothing for roles that cannot read
 * Intelligence, while the count is zero (including when insights are off), or when the read fails.
 */
export default async function AttentionBadge({ actor }: { actor: AuthorizationActor }) {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ)) return null;
  let badge: Awaited<ReturnType<typeof countInsightsInboxBadge>>;
  try {
    badge = await countInsightsInboxBadge(actor);
  } catch (error) {
    logger.warn('[Intelligence] Needs-attention badge not shown', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (badge.count === 0) return null;
  const label = `${badge.more ? 'More than ' : ''}${badge.count} ${
    badge.count === 1 && !badge.more ? 'insight needs' : 'insights need'
  } attention`;
  return (
    <Link
      href="/intelligence"
      aria-label={label}
      title={label}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-300 transition-colors after:absolute after:-inset-1 hover:bg-slate-800/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Inbox className="h-5 w-5" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[19px] top-0 flex h-[18px] min-w-[18px] select-none items-center justify-center rounded-full bg-status-elevated px-1 text-2xs font-bold leading-none tabular-nums text-slate-950 ring-2 ring-[#09090b]"
      >
        {badge.count}
        {badge.more && '+'}
      </span>
    </Link>
  );
}
