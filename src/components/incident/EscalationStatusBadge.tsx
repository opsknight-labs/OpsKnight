'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

type EscalationStatusBadgeProps = {
  status: string | null | undefined;
  currentStep: number | null | undefined;
  nextEscalationAt: Date | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
};

function EscalationStatusBadge({
  status,
  currentStep,
  nextEscalationAt,
  size = 'md',
  className,
}: EscalationStatusBadgeProps) {
  if (!status || status === 'COMPLETED') {
    return null;
  }

  const getTimeUntilNext = () => {
    if (!nextEscalationAt) return null;
    const now = new Date();
    const nextDate =
      nextEscalationAt instanceof Date ? nextEscalationAt : new Date(nextEscalationAt);
    const diff = nextDate.getTime() - now.getTime();
    if (diff < 0) return 'Due now';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w`;
  };

  const timeText = getTimeUntilNext();
  const compact = size === 'sm';
  const stepText =
    currentStep !== null && currentStep !== undefined ? `Step ${currentStep + 1}` : null;
  const titleParts = [
    status === 'ESCALATING' ? 'Escalating' : 'Escalation',
    stepText,
    timeText ? `Next: ${timeText}` : null,
  ].filter(Boolean);
  const labelParts = [
    status === 'ESCALATING' ? 'Escalating' : 'Escalation',
    !compact ? stepText : null,
    !compact && timeText ? timeText : null,
  ].filter(Boolean);

  const isEscalating = status === 'ESCALATING';

  return (
    <div
      className={cn(
        'gap-1.5 font-semibold rounded-md border transition-colors inline-flex items-center text-xs px-2.5 py-0.5 shadow-2xs leading-normal',
        isEscalating
          ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
        className
      )}
      title={titleParts.join(' - ')}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full ring-2 ring-offset-0 shrink-0',
          isEscalating
            ? 'bg-amber-500 ring-amber-200/70 animate-pulse'
            : 'bg-slate-400 ring-slate-200/70'
        )}
      />
      <span>{labelParts.join(' · ')}</span>
    </div>
  );
}

// Memoize EscalationStatusBadge to prevent unnecessary re-renders
export default memo(EscalationStatusBadge);
