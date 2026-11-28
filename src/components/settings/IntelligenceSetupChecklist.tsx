import Link from 'next/link';
import { CheckCircle2, CircleDashed, CircleDot } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import SwitchOnButton from '@/components/settings/SwitchOnButton';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import type { NoiseReadiness } from '@/lib/intelligence/noise-controls/manage';
import {
  setupChecklist,
  setupRevisions,
  setupStage,
  type SetupStage,
  type SetupState,
} from '@/lib/intelligence/settings/setup-contract';

const STAGES: ReadonlyArray<{ id: Exclude<SetupStage, 'off'>; title: string }> = [
  { id: 'learning', title: 'Learning' },
  { id: 'showing', title: 'Showing' },
  { id: 'acting', title: 'Acting' },
];

const SAYS: Record<SetupStage, string> = {
  off: 'Intelligence is off. Setting it up takes about three minutes, and nothing changes for your team until you decide.',
  learning:
    'Intelligence is learning from your incidents. Nobody’s paging changes and your team sees nothing new yet.',
  showing:
    'Your team sees suggestions on incidents. Noise controls are still watching, so no page is held back.',
  acting:
    'Noise controls are applied before anyone is paged, and your team sees suggestions. High-urgency alerts always page.',
};

/**
 * Where Intelligence is on the way to value, always visible at the top of Settings → Intelligence: off,
 * learning (watching, nothing changes), showing (the team sees suggestions) or acting (noise controls applied).
 * Managers get the next step: the guided start, or the one-click "Switch on" with the evidence. Everyone
 * can see the status and what is on.
 */
export default function IntelligenceSetupChecklist({
  state,
  canManage,
  readiness,
}: {
  state: SetupState;
  canManage: boolean;
  readiness: NoiseReadiness | null;
}) {
  const stage = setupStage(state);
  const items = setupChecklist(state);
  const revisions = setupRevisions(state);
  const noiseWatching = state.noise.mode === 'SHADOW';
  const ready = Boolean(readiness?.ready);
  // Learning: show suggestions (and noise ON when ready). Showing: only noise ON is left, and only when ready.
  const canSwitchOn =
    canManage && (stage === 'learning' || (stage === 'showing' && noiseWatching && ready));
  // eslint-disable-next-line security/detect-object-injection -- stage is the closed SetupStage union
  const says = SAYS[stage];
  return (
    <SettingsSection id="setup" title="Setup status" description={says}>
      {stage !== 'off' && (
        <ol aria-label="Where Intelligence is" className="flex flex-wrap gap-2 pt-4">
          {STAGES.map((entry, position) => {
            const here = STAGES.findIndex(candidate => candidate.id === stage);
            const isCurrent = entry.id === stage;
            return (
              <li
                key={entry.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
                  isCurrent
                    ? 'border-primary bg-primary/5 font-medium'
                    : 'border-border text-muted-foreground'
                )}
              >
                {position < here ? (
                  <CheckCircle2
                    className={cn('h-4 w-4', toneClasses('ok').text)}
                    aria-hidden="true"
                  />
                ) : isCurrent ? (
                  <CircleDot className="h-4 w-4 text-primary" aria-hidden="true" />
                ) : (
                  <CircleDashed className="h-4 w-4" aria-hidden="true" />
                )}
                {entry.title}
                <span className="sr-only">
                  {position < here ? ' (done)' : isCurrent ? ' (you are here)' : ' (not yet)'}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="space-y-3 pt-4">
        {stage === 'off' && canManage && (
          <Button asChild className="min-h-11 sm:min-h-10">
            <Link href="/settings/intelligence/setup">Get started</Link>
          </Button>
        )}
        {stage === 'off' && !canManage && (
          <p className="text-sm text-muted-foreground">Ask an administrator to turn it on.</p>
        )}
        {(stage === 'learning' || (stage === 'showing' && noiseWatching)) && readiness && (
          <div className="space-y-1" aria-live="polite">
            <p className="text-sm">
              Watched{' '}
              <span className="font-medium tabular-nums">
                {readiness.shadowDecisions} of {readiness.minimumShadowDecisions}
              </span>{' '}
              decisions in the last {readiness.windowDays} days.{' '}
              {ready
                ? 'That is enough evidence to apply noise controls.'
                : 'Keep watching until there is enough evidence to apply noise controls.'}
            </p>
            <div
              role="progressbar"
              aria-label="Watching evidence"
              aria-valuemin={0}
              aria-valuemax={readiness.minimumShadowDecisions}
              aria-valuenow={Math.min(readiness.shadowDecisions, readiness.minimumShadowDecisions)}
              className="h-2 max-w-md overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn('h-full rounded-full', toneClasses('ok').solid)}
                style={{
                  width: `${Math.min(100, Math.round((readiness.shadowDecisions / Math.max(1, readiness.minimumShadowDecisions)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
        {canSwitchOn && (
          <SwitchOnButton
            revisions={revisions}
            label={
              stage === 'showing'
                ? 'Turn noise controls on'
                : ready
                  ? 'Show suggestions and turn noise controls on'
                  : 'Show suggestions to my team'
            }
          />
        )}
        {stage === 'learning' && canManage && !ready && (
          <p className="text-xs text-muted-foreground">
            Showing suggestions never changes who is paged. Noise controls stay in watch mode until
            the evidence is there.
          </p>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-border">
        <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium sm:min-h-10">
          What is on
        </summary>
        <ul
          className="divide-y divide-border border-t border-border"
          aria-label="Intelligence setup"
        >
          {items.map(item => (
            <li
              key={item.id}
              data-setup-item={item.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {item.on ? (
                  <CheckCircle2
                    className={cn('mt-0.5 h-5 w-5 shrink-0', toneClasses('ok').text)}
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDashed
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {item.label}
                    <span className="sr-only">{item.on ? ' (on)' : ' (off)'}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{item.benefit}</p>
                </div>
              </div>
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="ml-8 h-11 shrink-0 self-start sm:ml-0 sm:h-9 sm:self-center"
              >
                <Link
                  href={item.href}
                  aria-label={item.on ? `Configure ${item.label}` : `Turn on ${item.label}`}
                >
                  {item.on ? 'Configure' : 'Turn on'}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </details>
    </SettingsSection>
  );
}
