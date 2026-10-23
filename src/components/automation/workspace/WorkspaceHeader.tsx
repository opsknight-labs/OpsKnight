'use client';
import { memo, useId } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Loader2,
  Lock,
  Rocket,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import type { Data } from '../presentation-types';
import { ModeBadge, modePresentation, toneClasses } from './status';
import type { SaveState } from './useAutomationDraft';
import { NativeSelect } from '../authoring/primitives';

const saveIndicators = new Map<SaveState, { icon: LucideIcon; tone: string; spin?: boolean }>([
  ['Saved', { icon: CheckCircle2, tone: toneClasses.ok }],
  ['Unsaved', { icon: CircleDot, tone: toneClasses.warn }],
  ['Saving…', { icon: Loader2, tone: toneClasses.muted, spin: true }],
]);

export const WorkspaceHeader = memo(function WorkspaceHeader({
  status,
  saveState,
  busy,
  publishBlockedReason,
  onPublish,
  onModeChange,
}: {
  status: Data | null;
  saveState: SaveState;
  busy: boolean;
  publishBlockedReason: string | null;
  onPublish: () => void;
  onModeChange: (mode: string) => void;
}) {
  const hintId = useId();
  const indicator = saveIndicators.get(saveState) ?? {
    icon: AlertTriangle,
    tone: toneClasses.error,
  };
  const SaveIcon = indicator.icon;
  const mode = status?.mode ?? 'DISABLED';

  return (
    <header className="overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-xs">
      <div className="flex flex-col gap-3 p-3.5 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary sm:flex"
          >
            <Workflow className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                Automation
              </h2>
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Beta
              </Badge>
              {status ? (
                <ModeBadge mode={mode} />
              ) : (
                <Badge variant="outline" className="text-xs">
                  Loading…
                </Badge>
              )}
              <div className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <SaveIcon
                  aria-hidden="true"
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    indicator.tone,
                    indicator.spin && 'animate-spin'
                  )}
                />
                <p className="font-mono text-[11px] sm:text-xs">
                  Version {status?.activeVersion?.versionNumber ?? '—'} · {saveState} · Global{' '}
                  {status?.enabled ? 'ON' : 'OFF'}
                </p>
              </div>
            </div>
            {status && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <p>
                  {status.activeVersion
                    ? `Last published ${new Date(status.activeVersion.publishedAt).toLocaleString()}. `
                    : 'No version published yet. '}
                  <span className="text-foreground/80">{modePresentation(mode).summary}</span>
                </p>
                {!status.canEdit && (
                  <p className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Read only
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {status?.canPublish ? (
          <div className="flex flex-col gap-1 sm:items-end">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <NativeSelect
                aria-label="Automation mode"
                wrapperClassName="w-full sm:w-auto"
                className={cn(
                  'h-9 text-xs font-medium w-full sm:w-auto',
                  status.mode === 'LIVE' &&
                    'border-emerald-500/50 bg-emerald-50/20 text-emerald-900 font-semibold dark:border-emerald-500/40 dark:bg-emerald-950/20 dark:text-emerald-300',
                  status.mode === 'SHADOW' &&
                    'border-amber-500/50 bg-amber-50/20 text-amber-900 font-semibold dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-300'
                )}
                value={status.mode}
                disabled={busy}
                onChange={event => onModeChange(event.target.value)}
              >
                <option value="DISABLED">DISABLED · off</option>
                <option value="SHADOW" disabled={!status.enabled}>
                  SHADOW · compare only
                </option>
                <option value="LIVE" disabled={!status.enabled}>
                  LIVE · apply routing
                </option>
              </NativeSelect>
              <Button
                size="sm"
                className="h-9 gap-1.5 px-3.5 text-xs font-medium shadow-xs transition-all w-full sm:w-auto"
                disabled={busy || !!publishBlockedReason}
                aria-describedby={publishBlockedReason ? hintId : undefined}
                onClick={onPublish}
              >
                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
                {mode === 'LIVE' ? 'Publish candidate' : 'Publish'}
              </Button>
            </div>
            {publishBlockedReason && (
              <p id={hintId} className="text-[11px] text-destructive sm:text-right">
                {publishBlockedReason}
              </p>
            )}
            {mode === 'LIVE' && !publishBlockedReason && (
              <p className="text-[11px] text-muted-foreground/80 sm:text-right">
                Publishing while LIVE stages a candidate version for parallel shadow evaluation
                without interrupting routing.
              </p>
            )}
            {!status.enabled && !publishBlockedReason && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 sm:text-right">
                SHADOW and LIVE require global automation enabled.
              </p>
            )}
          </div>
        ) : (
          status && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground lg:max-w-56 lg:text-right">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Only administrators can publish or change the mode.
            </p>
          )
        )}
      </div>
    </header>
  );
});
