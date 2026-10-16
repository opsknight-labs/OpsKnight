import { Archive, Hand, PauseCircle, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RuleStatusKind } from './rule-presentation';

type StatusStyle = { label: string; icon: LucideIcon; className: string };
export const RULE_STATUS_STYLE = new Map<RuleStatusKind, StatusStyle & { accent: string }>([
  [
    'AUTOMATIC',
    {
      label: 'Automatic',
      icon: Zap,
      className: 'bg-indigo-500/10 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300',
      accent: 'bg-indigo-500',
    },
  ],
  [
    'SUGGESTED',
    {
      label: 'Suggested',
      icon: Sparkles,
      className: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
      accent: 'bg-amber-500',
    },
  ],
  [
    'MANUAL',
    {
      label: 'Manual',
      icon: Hand,
      className: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300',
      accent: 'bg-sky-500',
    },
  ],
  [
    'PAUSED',
    {
      label: 'Paused',
      icon: PauseCircle,
      className: 'bg-muted/60 text-muted-foreground ring-border',
      accent: 'bg-muted-foreground/30',
    },
  ],
  [
    'ARCHIVED',
    {
      label: 'Archived',
      icon: Archive,
      className: 'border border-dashed border-muted-foreground/40 text-muted-foreground ring-0',
      accent: 'bg-transparent',
    },
  ],
]);

export function RuleStatusPill({ kind, className }: { kind: RuleStatusKind; className?: string }) {
  const {
    label,
    icon: Icon,
    className: tone,
  } = RULE_STATUS_STYLE.get(kind) ?? RULE_STATUS_STYLE.get('MANUAL')!;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        tone,
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
