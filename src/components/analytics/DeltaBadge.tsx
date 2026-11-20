import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { toneClasses } from '@/components/patterns';
import { cn } from '@/lib/utils';
import type { describeDelta } from './format';

/** Change vs the previous period: icon + text + tone, never colour alone. */
export default function DeltaBadge({
  delta,
  compact = false,
}: {
  delta: ReturnType<typeof describeDelta>;
  compact?: boolean;
}) {
  if (!delta) return null;
  const Icon =
    delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus;
  const tone =
    delta.tone === 'good'
      ? toneClasses('ok').soft
      : delta.tone === 'bad'
        ? toneClasses('critical').soft
        : 'border-border bg-muted text-muted-foreground';
  const meaning = delta.tone === 'good' ? 'better' : delta.tone === 'bad' ? 'worse' : 'neutral';
  return (
    <span
      title={`${delta.label} vs previous period (${meaning})`}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border font-medium tabular-nums',
        compact ? 'px-1.5 text-2xs' : 'px-2 py-0.5 text-xs',
        tone
      )}
    >
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      {delta.label}
      <span className="sr-only"> vs previous period, {meaning}</span>
    </span>
  );
}
