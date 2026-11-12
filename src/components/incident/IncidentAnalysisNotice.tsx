'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type { IncidentAnalysisState } from '@/lib/intelligence/analysis/contract';

const POLLING = new Set(['WAITING', 'STALE', 'PAUSED']);
const MAX_CHECKS = 8;
const INTERVAL_MS = 15_000;

/** Poll only while work is unresolved, with a fixed request budget and no hidden-tab requests. */
export default function IncidentAnalysisNotice({
  incidentId,
  initial,
}: {
  incidentId: string;
  initial: IncidentAnalysisState;
}) {
  const { refresh } = useRouter();
  const { userTimeZone } = useTimezone();
  const element = useRef<HTMLDivElement>(null);
  const inViewport = useRef(true);
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
  const tone =
    state.status === 'CURRENT' && state.lastSuccessfulAt
      ? 'border-status-ok/40 bg-status-ok-soft dark:bg-status-ok/10'
      : state.status === 'FAILED'
        ? 'border-status-critical/40 bg-status-critical-soft dark:bg-status-critical/10'
        : POLLING.has(state.status)
          ? 'border-status-elevated/40 bg-status-elevated-soft dark:bg-status-elevated/10'
          : 'border-border bg-muted/30';
  return (
    <div
      ref={element}
      role="group"
      aria-label="Recommendation freshness"
      className={`mb-3 rounded-lg border p-3 text-sm text-foreground ${tone}`}
    >
      <p role="status" aria-live="polite" aria-atomic="true">
        {state.message}
      </p>
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
          className="min-h-11 rounded border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-8 sm:px-2"
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {state.canRefresh && (
          <button
            type="button"
            disabled={checking || refreshing}
            onClick={() => void requestRefresh()}
            className="min-h-11 rounded border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:min-h-8 sm:px-2"
          >
            Refresh recommendations
          </button>
        )}
        {state.diagnosticsHref && (
          <Link
            href="/settings/intelligence"
            className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-8"
          >
            Operator diagnostics
          </Link>
        )}
      </div>
    </div>
  );
}
