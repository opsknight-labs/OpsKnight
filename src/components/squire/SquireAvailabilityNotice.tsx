'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toneClasses } from '@/components/patterns/status-tone';
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
// 44 px tall on phones; a text-sized link in the desktop panel's slim line.
const actionClass =
  'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60 sm:min-h-7';

/**
 * The one slim status line under the chat header: a pill naming the mode, one sentence on why and what
 * answers use instead, and the next step (retry, or a settings link for people who manage AI). The whole
 * sentence stays readable on hover and to screen readers when it is truncated.
 */
export default function SquireAvailabilityNotice({
  state,
  rateLimit,
  canManageAi,
  canRetry,
  onRetry,
  reason = null,
}: {
  state: SquireAvailabilityState;
  rateLimit: SquireRateLimit | null;
  /** In `basic`: the setting that keeps AI out (e.g. no provider may receive the data). Retrying cannot help. */
  reason?: string | null;
  /** The person may change AI settings, so the action links there instead of asking an administrator. */
  canManageAi: boolean;
  /** There is a question to ask again. */
  canRetry: boolean;
  onRetry: () => void;
}) {
  const seconds = useSecondsUntil(state === 'rate_limited' ? (rateLimit?.until ?? null) : null);
  // Waiting is a warning; basic mode is information.
  const tone = toneClasses(state === 'rate_limited' || state === 'budget' ? 'elevated' : 'info');
  const pill =
    state === 'rate_limited' ? 'Rate limited' : state === 'budget' ? 'Budget reached' : 'Basic mode';
  const title =
    state === 'rate_limited'
      ? 'Too many requests'
      : state === 'budget'
        ? 'Daily AI budget reached'
        : state === 'disabled'
          ? 'AI is off'
          : 'AI unavailable';
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
            ? 'Answers use your incident data.'
            : 'Answers use your incident data. An administrator can turn on AI.'
          : reason
            ? `${reason}. Answers use your incident data${canManageAi ? '' : ' until an administrator changes the AI providers'}.`
            : 'AI could not answer, so this answer uses your incident data.';
  const sentence = `${title} · ${detail}`;
  return (
    <div
      role="status"
      data-testid="squire-availability"
      data-state={state}
      className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 text-xs text-muted-foreground"
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${tone.soft}`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.solid}`} />
        {pill}
      </span>
      <p className="min-w-0 flex-1 truncate" title={sentence}>
        {sentence}
      </p>
      {(state === 'rate_limited' || (state === 'basic' && !reason)) && canRetry && (
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
      {state === 'basic' && reason && canManageAi && (
        <Link href={`${AI_SETTINGS_HREF}#providers`} className={actionClass}>
          Review AI providers
        </Link>
      )}
    </div>
  );
}
