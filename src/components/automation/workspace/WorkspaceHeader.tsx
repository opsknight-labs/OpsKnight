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
import { controlClass } from './constants';
import { ModeBadge, modePresentation, toneClasses } from './status';
import type { SaveState } from './useAutomationDraft';

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
    <header className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <div
            aria-hidden="true"
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex"
          >
            <Workflow className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
              Automation <Badge variant="secondary">Beta</Badge>
              {status ? <ModeBadge mode={mode} /> : <Badge variant="outline">Loading…</Badge>}
            </h2>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <SaveIcon
                aria-hidden="true"
                className={cn('h-4 w-4 shrink-0', indicator.tone, indicator.spin && 'animate-spin')}
              />
              <p>
                Version {status?.activeVersion?.versionNumber ?? '—'} · {saveState} · Global{' '}
                {status?.enabled ? 'ON' : 'OFF'}
              </p>
            </div>
            {status && (
              <p className="text-xs text-muted-foreground">
                {status.activeVersion
                  ? `Last published ${new Date(status.activeVersion.publishedAt).toLocaleString()}. `
                  : 'No version published yet. '}
                {modePresentation(mode).summary}
              </p>
            )}
            {status && !status.canEdit && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Read only. Your role can view automation but not edit the draft.
              </p>
            )}
          </div>
        </div>
        {status?.canPublish ? (
          <div className="flex flex-col gap-1.5 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Automation mode"
                className={cn(controlClass, 'min-w-0 flex-1 sm:flex-none')}
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
              </select>
              <Button
                className="h-10"
                disabled={busy || !!publishBlockedReason}
                aria-describedby={publishBlockedReason ? hintId : undefined}
                onClick={onPublish}
              >
                <Rocket aria-hidden="true" />
                {mode === 'LIVE' ? 'Publish candidate' : 'Publish'}
              </Button>
            </div>
            {publishBlockedReason && (
              <p id={hintId} className="text-xs text-muted-foreground lg:text-right">
                {publishBlockedReason}
              </p>
            )}
            {mode === 'LIVE' && (
              <p className="text-xs text-muted-foreground lg:text-right">
                Publishing while LIVE stages a candidate version for parallel shadow evaluation without interrupting routing.
              </p>
            )}
            {!status.enabled && (
              <p className="text-xs text-muted-foreground lg:text-right">
                SHADOW and LIVE need the global switch.
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
