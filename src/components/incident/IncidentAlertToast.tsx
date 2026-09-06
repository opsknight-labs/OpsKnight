'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast as sonnerToast } from 'sonner';
import { X, ArrowUpRight, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncidentAlertItem = {
  id: string;
  title: string;
  priority?: string | null;
  urgency?: string | null;
  status?: string | null;
  service?: {
    id?: string;
    name: string;
  } | null;
  createdAt?: Date | string | null;
};

export interface IncidentAlertToastProps {
  toastId: string | number;
  incidents: IncidentAlertItem[];
  onAcknowledge?: (id: string) => Promise<void> | void;
}

function cleanTitle(title: string): string {
  // Strip leading sirens, warning symbols, or emojis to avoid duplication
  return title.replace(/^[\s🚨🔥⚡🛑⚠️]+/, '').trim() || title;
}

function PriorityPill({
  priority,
  urgency,
}: {
  priority?: string | null;
  urgency?: string | null;
}) {
  const p = priority?.toUpperCase() || (urgency === 'HIGH' ? 'HIGH' : urgency ? urgency.toUpperCase() : 'ALERT');
  const color =
    p === 'P1' || p === 'HIGH'
      ? 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800/60'
      : p === 'P2' || p === 'MEDIUM'
        ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800/60'
        : 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800/60';
  return (
    <span
      className={cn(
        'px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase shrink-0 leading-none',
        color
      )}
    >
      {p}
    </span>
  );
}

function getPriorityBorder(priority?: string | null, urgency?: string | null): string {
  const p = priority?.toUpperCase();
  if (p === 'P1' || (!p && urgency === 'HIGH')) return 'bg-rose-600';
  if (p === 'P2' || (!p && urgency === 'MEDIUM')) return 'bg-amber-500';
  if (p === 'P3' || (!p && urgency === 'LOW')) return 'bg-blue-500';
  return 'bg-slate-500';
}

export function IncidentAlertToast({ toastId, incidents, onAcknowledge }: IncidentAlertToastProps) {
  const [ackingId, setAckingId] = useState<string | null>(null);
  const isMultiple = incidents.length > 1;
  const primaryIncident = incidents[0];

  const handleAck = async (id: string) => {
    if (!onAcknowledge) return;
    setAckingId(id);
    try {
      await onAcknowledge(id);
      sonnerToast.dismiss(toastId);
    } catch {
      setAckingId(null);
    }
  };

  if (!primaryIncident) return null;

  // Compact Single Incident Alert Card
  if (!isMultiple) {
    const barBg = getPriorityBorder(primaryIncident.priority, primaryIncident.urgency);

    return (
      <div
        className={cn(
          'relative w-[min(380px,calc(100vw-24px))] rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100',
          'shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18),0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[0_16px_36px_-8px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.08)] overflow-hidden transition-all duration-200'
        )}
      >
        {/* Left priority accent stripe */}
        <div className={cn('absolute left-0 top-0 bottom-0 w-1', barBg)} />

        <div className="pl-3.5 pr-2.5 py-2.5 flex items-start gap-2.5">
          {/* Pulsing Beacon */}
          <div className="pt-1 shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
            </span>
          </div>

          <div className="flex-1 min-w-0">
            {/* Top row: Priority Pill + Service + ID */}
            <div className="flex items-center gap-1.5 mb-1 leading-none">
              <PriorityPill priority={primaryIncident.priority} urgency={primaryIncident.urgency} />
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[160px]">
                {primaryIncident.service?.name || 'Incident'}
              </span>
              <span className="text-slate-300 dark:text-slate-700">&middot;</span>
              <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                #{primaryIncident.id.slice(-5).toUpperCase()}
              </span>
            </div>

            {/* Title: 1 line truncate */}
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug line-clamp-1 break-words">
              {cleanTitle(primaryIncident.title)}
            </h4>

            {/* Bottom Actions Row */}
            <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-3">
                <Link
                  href={`/incidents/${primaryIncident.id}`}
                  onClick={() => sonnerToast.dismiss(toastId)}
                  className="inline-flex items-center gap-0.5 font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
                >
                  <span>View</span>
                  <ArrowUpRight size={11} className="shrink-0" />
                </Link>

                {onAcknowledge && (
                  <button
                    type="button"
                    onClick={() => handleAck(primaryIncident.id)}
                    disabled={ackingId === primaryIncident.id}
                    className="font-bold text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {ackingId === primaryIncident.id ? (
                      <Loader2 size={11} className="animate-spin shrink-0" />
                    ) : (
                      <Check size={11} className="shrink-0 stroke-[2.5]" />
                    )}
                    <span>Acknowledge</span>
                  </button>
                )}
              </div>

              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Just now</span>
            </div>
          </div>

          {/* Prominent, working Cross ("X") dismiss button */}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              sonnerToast.dismiss(toastId);
            }}
            className="shrink-0 h-6 w-6 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Dismiss incident alert"
          >
            <X size={14} className="shrink-0 stroke-[2.5]" />
          </button>
        </div>
      </div>
    );
  }

  // Compact Multiple Incidents Alert Card
  return (
    <div
      className={cn(
        'relative w-[min(380px,calc(100vw-24px))] rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100',
        'shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18),0_0_0_1px_rgba(15,23,42,0.06)] dark:shadow-[0_16px_36px_-8px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.08)] overflow-hidden transition-all duration-200'
      )}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-600" />

      <div className="p-2.5">
        {/* Header */}
        <div className="pl-1.5 pr-0.5 flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600" />
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              {incidents.length} New Incidents
            </span>
          </div>

          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              sonnerToast.dismiss(toastId);
            }}
            className="shrink-0 h-5 w-5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Dismiss all incident alerts"
          >
            <X size={13} className="shrink-0 stroke-[2.5]" />
          </button>
        </div>

        {/* Compact incidents list preview (up to 2 items) */}
        <div className="space-y-1">
          {incidents.slice(0, 2).map(item => (
            <Link
              key={item.id}
              href={`/incidents/${item.id}`}
              onClick={() => sonnerToast.dismiss(toastId)}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group cursor-pointer text-xs"
            >
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <PriorityPill priority={item.priority} urgency={item.urgency} />
                <span className="font-semibold text-[11px] text-slate-900 dark:text-slate-200 truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                  {cleanTitle(item.title)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 max-w-[100px] truncate">
                {item.service?.name || 'Service'}
              </span>
            </Link>
          ))}
          {incidents.length > 2 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center font-medium pt-0.5">
              +{incidents.length - 2} more incidents on board
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] px-1">
          <Link
            href="/incidents"
            onClick={() => sonnerToast.dismiss(toastId)}
            className="inline-flex items-center gap-0.5 font-bold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
          >
            <span>View board</span>
            <ArrowUpRight size={11} className="shrink-0" />
          </Link>

          <button
            type="button"
            onClick={() => sonnerToast.dismiss(toastId)}
            className="text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            Dismiss all
          </button>
        </div>
      </div>
    </div>
  );
}

export default IncidentAlertToast;
