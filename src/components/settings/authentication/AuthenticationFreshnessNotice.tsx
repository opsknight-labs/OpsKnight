'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useAuthenticationWorkspace } from './useAuthenticationController';

const WARN_BEFORE_MS = 30 * 60 * 1000;
const RETURN_TO_CONSOLE = '/settings/system?section=sso';

function minutesLeft(expiresAt: string | null, now: number) {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

/**
 * Security changes need an administrator sign-in from the last two hours. Say so before the
 * window closes, with a one-click way to renew it, instead of surprising the administrator with
 * a blocker halfway through setup.
 */
export default function AuthenticationFreshnessNotice() {
  const { data } = useAuthenticationWorkspace();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (data.actor.kind !== 'admin') return null;
  const minutes = minutesLeft(data.freshAuthenticationExpiresAt, now);
  const expired = data.freshAuthenticationRequired || minutes === 0;
  if (!expired && (minutes === null || minutes * 60_000 > WARN_BEFORE_MS)) return null;

  const renewHref = `/auth/signout?${new URLSearchParams({ callbackUrl: RETURN_TO_CONSOLE })}`;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
    >
      <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
      <span className="min-w-0 flex-1 text-foreground">
        {expired
          ? 'Security changes need a sign-in from the last two hours. Sign in again to continue; your saved configurations are kept.'
          : `Your administrator sign-in can make security changes for ${minutes} more minute${minutes === 1 ? '' : 's'}. Renew it now so setup is not interrupted.`}
      </span>
      <a href={renewHref} className="font-semibold text-foreground underline underline-offset-2">
        Sign in again
      </a>
    </div>
  );
}
