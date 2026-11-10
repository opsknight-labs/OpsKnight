'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Clock, PowerOff, RefreshCw, Sparkles, Wallet } from 'lucide-react';
import type { AiAvailability } from './presence';

/**
 * Why the assistant is not answering with AI right now. Each state has its own wording and its own next
 * step, so a person can tell "wait a moment" from "an administrator has to act":
 * - `rate_limited`: too many requests in a short time; retry (after the server's Retry-After, if given).
 * - `budget`: the organization's daily AI budget is used up; basic answers continue, an administrator can
 *   raise it.
 * - `disabled`: an administrator has not turned AI on; basic answers from incident data are available.
 * - `basic`: AI is on but could not answer (no permitted provider, provider failure); retry with AI.
 */
export type SquireAvailabilityState = 'rate_limited' | 'budget' | 'disabled' | 'basic';

/** A request limit the person hit: an HTTP 429, or an AI rate limit reported in the stream. */
export type SquireRateLimit = {
  /** Epoch milliseconds before which a retry will be refused again; null when the server did not say. */
  until: number | null;
};

export function squireAvailabilityState(input: {
  availability: AiAvailability;
  rateLimit: SquireRateLimit | null;
}): SquireAvailabilityState | null {
  if (input.rateLimit) return 'rate_limited';
  if (input.availability === 'quota') return 'budget';
  if (input.availability === 'disabled') return 'disabled';
  if (input.availability === 'unavailable') return 'basic';
  return null;
}

/** Parses a Retry-After header (delta seconds or an HTTP date) into an epoch time, capped at 15 minutes. */
export function retryAfterUntil(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : (Date.parse(trimmed) - now) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return now + Math.min(seconds, 15 * 60) * 1000;
}

/** Whole seconds left until `until`, ticking once a second only while a countdown is running. */
function useSecondsUntil(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

const AI_SETTINGS_HREF = '/settings/intelligence/ai';
const actionClass =
  'inline-flex min-h-11 items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-xs font-medium hover:bg-background/60 disabled:cursor-not-allowed disabled:opacity-60';

export default function SquireAvailabilityNotice({
  state,
  rateLimit,
  canManageAi,
  canRetry,
  onRetry,
}: {
  state: SquireAvailabilityState;
  rateLimit: SquireRateLimit | null;
  /** The person may change AI settings, so the action links there instead of asking an administrator. */
  canManageAi: boolean;
  /** There is a question to ask again. */
  canRetry: boolean;
  onRetry: () => void;
}) {
  const seconds = useSecondsUntil(state === 'rate_limited' ? (rateLimit?.until ?? null) : null);
  const tone =
    state === 'rate_limited' || state === 'budget'
      ? 'border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100'
      : 'border-border bg-muted/30 text-foreground';
  const Icon =
    state === 'rate_limited'
      ? Clock
      : state === 'budget'
        ? Wallet
        : state === 'disabled'
          ? PowerOff
          : Sparkles;
  const title =
    state === 'rate_limited'
      ? 'Too many requests'
      : state === 'budget'
        ? 'Daily AI budget reached'
        : state === 'disabled'
          ? 'AI is off · basic mode'
          : 'Basic mode · AI unavailable';
  const detail =
    state === 'rate_limited'
      ? seconds > 0
        ? `You can retry in ${seconds} second${seconds === 1 ? '' : 's'}.`
        : 'Wait a moment, then retry.'
      : state === 'budget'
        ? canManageAi
          ? 'Answers use your incident data until the budget resets at 00:00 UTC, or you raise it.'
          : 'Answers use your incident data until the budget resets at 00:00 UTC. An administrator can raise it.'
        : state === 'disabled'
          ? canManageAi
            ? 'Answers use your incident data. You can turn on AI in settings.'
            : 'Answers use your incident data. An administrator can turn on AI.'
          : 'AI could not answer, so this answer uses your incident data.';
  return (
    <div
      role="status"
      data-testid="squire-availability"
      data-state={state}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs ${tone}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{title}.</span> {detail}
      </p>
      {(state === 'rate_limited' || state === 'basic') && canRetry && (
        <button
          type="button"
          className={actionClass}
          disabled={state === 'rate_limited' && seconds > 0}
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {state === 'basic' ? 'Retry with AI' : seconds > 0 ? `Retry in ${seconds}s` : 'Retry'}
        </button>
      )}
      {(state === 'budget' || state === 'disabled') && canManageAi && (
        <Link href={AI_SETTINGS_HREF} className={actionClass}>
          {state === 'budget' ? 'Review AI budget' : 'Turn on AI'}
        </Link>
      )}
    </div>
  );
}
