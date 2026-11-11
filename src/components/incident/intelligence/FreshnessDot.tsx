'use client';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type { IncidentAnalysisState } from '@/lib/intelligence/analysis/contract';

const POLLING = new Set(['WAITING', 'STALE', 'PAUSED']);
const MAX_CHECKS = 8;
const INTERVAL_MS = 15_000;

const DOT_CLASS: Record<string, string> = {
  CURRENT: 'bg-status-ok',
  FAILED: 'bg-status-critical',
  WAITING: 'bg-status-elevated',
  STALE: 'bg-status-elevated',
  PAUSED: 'bg-status-elevated',
};

const SHORT_LABEL: Record<string, string> = {
  CURRENT: 'Up to date',
  FAILED: 'Needs review',
  WAITING: 'Analysing',
  STALE: 'Refreshing',
  PAUSED: 'Paused',
  UNAVAILABLE: 'Unavailable',
};

const ACTION_BASE =
  'min-h-11 rounded border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
const DOT_BASE =
  'inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The one place the incident page states how fresh its recommendations are.
 *
 * `variant="dot"` (the strip): a status dot with a short label; activating it discloses the full message, the
 * last completion time and the actions. `variant="inline"` (the inspector header): the same content, always
 * expanded. Polls only while work is unresolved, with a fixed request budget and no hidden-tab requests;
 * analysis is never requested automatically, only by an operator's click on "Refresh recommendations".
 */
export default function FreshnessDot({
  incidentId,
  initial,
  variant = 'dot',
  align = 'end',
  touch = false,
}: {
  incidentId: string;
  initial: IncidentAnalysisState;
  variant?: 'dot' | 'inline';
  /** Which edge of the dot the disclosure hangs from; `start` when the dot is alone on the row. */
  align?: 'start' | 'end';
  /** The mobile route: keep 44 px targets at every width, including a phone held sideways. */
  touch?: boolean;
}) {
  const actionClass = touch ? ACTION_BASE : `${ACTION_BASE} sm:min-h-8 sm:px-2`;
  const linkClass = touch
    ? 'inline-flex min-h-11 items-center underline underline-offset-2'
    : 'inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-8';
  const { refresh } = useRouter();
  const { userTimeZone } = useTimezone();
  const element = useRef<HTMLDivElement>(null);
  const inViewport = useRef(true);
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return;
    inViewport.current = false;
    const observer = new IntersectionObserver(entries => {
      inViewport.current = entries.some(entry => entry.isIntersecting);
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const [state, setState] = useState(initial);
  const [epoch, setEpoch] = useState(0);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (refreshing || (!POLLING.has(initial.status) && epoch === 0)) return;
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const check = async () => {
      if (stopped || attempts >= MAX_CHECKS) return;
      if (
        document.visibilityState === 'hidden' ||
        (!inViewport.current && !(epoch > 0 && attempts === 0))
      ) {
        timer = setTimeout(check, INTERVAL_MS);
        return;
      }
      attempts += 1;
      controller = new AbortController();
      setChecking(true);
      let keepChecking = true;
      try {
        const response = await fetch(
          `/api/intelligence/incidents/${encodeURIComponent(incidentId)}/analysis`,
          { cache: 'no-store', signal: controller.signal }
        );
        const body = (await response.json()) as { data?: { analysis?: IncidentAnalysisState } };
        if (stopped) return;
        if (response.ok && body.data?.analysis) {
          const next = body.data.analysis;
          setState(next);
          setError('');
          keepChecking = POLLING.has(next.status);
          if (
            next.status === 'CURRENT' &&
            (initial.status !== 'CURRENT' || next.lastSuccessfulAt !== initial.lastSuccessfulAt)
          )
            refresh();
        } else {
          setError('The latest analysis state could not be checked.');
          if ([401, 403, 404, 429].includes(response.status)) keepChecking = false;
          if ([401, 403, 404].includes(response.status)) refresh();
        }
      } catch {
        if (!stopped) setError('The latest analysis state could not be checked.');
      } finally {
        if (!stopped) {
          setChecking(false);
          if (keepChecking && attempts < MAX_CHECKS) timer = setTimeout(check, INTERVAL_MS);
        }
      }
    };
    timer = setTimeout(check, epoch ? 0 : INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [incidentId, initial.status, initial.lastSuccessfulAt, epoch, refreshing, refresh]);

  useEffect(() => {
    if (!expanded || variant !== 'dot') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (element.current && !element.current.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [expanded, variant]);

  const requestRefresh = async () => {
    if (checking || refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch(
        `/api/intelligence/incidents/${encodeURIComponent(incidentId)}/analysis`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      if (!response.ok) {
        setError('Analysis could not be requested. Open operator diagnostics to review its state.');
        return;
      }
      setState(current => ({
        ...current,
        status: current.lastSuccessfulAt ? 'STALE' : 'WAITING',
        message:
          'Recommendation analysis requested. Earlier suggestions remain visible until it completes.',
      }));
      setEpoch(value => value + 1);
    } catch {
      setError('The request could not be confirmed. Check its status before trying again.');
    } finally {
      setRefreshing(false);
    }
  };

  const dot = (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[state.status] ?? 'bg-muted-foreground'} ${
        POLLING.has(state.status) ? 'motion-safe:animate-pulse' : ''
      }`}
    />
  );
  const details = (
    <>
      {state.lastSuccessfulAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          Last completed{' '}
          <time dateTime={state.lastSuccessfulAt}>
            {formatDateTime(state.lastSuccessfulAt, userTimeZone, { includeTimeZone: true })}
          </time>
        </p>
      )}
      {error && (
        <p className="mt-1 text-xs" role="status">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          disabled={checking || refreshing}
          onClick={() => setEpoch(value => value + 1)}
          className={actionClass}
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {state.canRefresh && (
          <button
            type="button"
            disabled={checking || refreshing}
            onClick={() => void requestRefresh()}
            className={actionClass}
          >
            Refresh recommendations
          </button>
        )}
        {state.diagnosticsHref && (
          <Link href="/settings/intelligence" className={linkClass}>
            Operator diagnostics
          </Link>
        )}
      </div>
    </>
  );

  if (variant === 'inline')
    return (
      <div
        ref={element}
        role="group"
        aria-label="Recommendation freshness"
        className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground"
      >
        <p role="status" aria-live="polite" aria-atomic="true" className="flex items-center gap-2">
          {dot}
          <span>{state.message}</span>
        </p>
        {details}
      </div>
    );

  return (
    <div
      ref={element}
      role="group"
      aria-label="Recommendation freshness"
      className="relative shrink-0"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        title={state.message}
        onClick={() => setExpanded(value => !value)}
        className={touch ? DOT_BASE : `${DOT_BASE} sm:min-h-8`}
      >
        {dot}
        <span>{SHORT_LABEL[state.status] ?? 'Analysis'}</span>
        <span className="sr-only">: recommendation freshness details</span>
      </button>
      {/* Always in the accessibility tree, so the state is announced without opening the disclosure. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {state.message}
      </p>
      {expanded && (
        <div
          id={panelId}
          className={`absolute z-40 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg ${
            align === 'start' ? 'left-0' : 'right-0'
          }`}
        >
          <p aria-hidden="true">{state.message}</p>
          {details}
        </div>
      )}
    </div>
  );
}
