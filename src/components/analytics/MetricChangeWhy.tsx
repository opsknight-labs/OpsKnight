'use client';

import { useId, useState } from 'react';
import { explainMetricChangeAction } from '@/app/(app)/insights/helper-actions';
import type { ChangeMetric } from '@/lib/intelligence/helpers/metric-change';
import type { MetricChangeDetail } from '@/lib/intelligence/helpers/metric-change-loader';

/**
 * One quiet line under an analytics card saying which services moved the number. "Why?" expands it with
 * the numbers behind it and, when an AI provider is set up, a short plain-language phrasing; nothing is
 * requested until a person asks.
 */
export default function MetricChangeWhy({
  metric,
  line,
  windowDays,
  teamId,
}: {
  metric: ChangeMetric;
  line: string;
  windowDays: number;
  teamId?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [detail, setDetail] = useState<MetricChangeDetail | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || state !== 'idle') return;
    setState('loading');
    explainMetricChangeAction({ metric, windowDays, ...(teamId ? { teamId } : {}) })
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setState('done'));
  };

  return (
    <div className="mt-1 text-xs text-muted-foreground" data-testid={`metric-change-${metric}`}>
      <div className="flex items-center gap-1">
        {/* Truncated while closed; opening shows the whole line, since touch screens have no tooltip. */}
        <p className={`min-w-0 flex-1 ${open ? '' : 'truncate'}`} title={line}>
          {line}
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="-my-3 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 font-medium text-foreground/80 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Why?
        </button>
      </div>
      {open && (
        <div id={panelId} aria-live="polite" className="space-y-1 pb-1">
          {state === 'loading' && <p>Working it out…</p>}
          {state === 'done' && !detail && <p>No further detail is available right now.</p>}
          {detail?.phrasing && <p className="text-foreground">{detail.phrasing}</p>}
          {detail && <p>{detail.detail} From daily rollups, so today is not included.</p>}
        </div>
      )}
    </div>
  );
}
