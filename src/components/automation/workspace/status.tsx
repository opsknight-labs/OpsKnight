import { Eye, PowerOff, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type ModePresentation = {
  icon: LucideIcon;
  label: string;
  summary: string;
  className: string;
};

const modes = new Map<string, ModePresentation>([
  [
    'DISABLED',
    {
      icon: PowerOff,
      label: 'DISABLED',
      summary: 'New alerts are not evaluated. Incidents use the service route.',
      className: 'border-border bg-muted text-muted-foreground',
    },
  ],
  [
    'SHADOW',
    {
      icon: Eye,
      label: 'SHADOW',
      summary: 'Compares outcomes on new alerts. Incidents keep the service route.',
      className:
        'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200',
    },
  ],
  [
    'LIVE',
    {
      icon: Zap,
      label: 'LIVE',
      summary: 'New incidents use the published routing and enrichment.',
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200',
    },
  ],
]);

export function modePresentation(mode: string): ModePresentation {
  return modes.get(mode) ?? { ...modes.get('DISABLED')!, label: mode };
}

/** Mode indicator that pairs an icon with the mode name so status never relies on colour. */
export function ModeBadge({ mode, className }: { mode: string; className?: string }) {
  const { icon: Icon, label, className: tone } = modePresentation(mode);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold leading-4 tracking-wide',
        tone,
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

export const toneClasses = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-800 dark:text-amber-300',
  error: 'text-destructive dark:text-rose-300',
  muted: 'text-muted-foreground',
} as const;

export const noticeClasses = {
  info: 'border-border bg-muted/40 text-foreground',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
  error:
    'border-destructive/40 bg-destructive/5 text-destructive dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
} as const;
