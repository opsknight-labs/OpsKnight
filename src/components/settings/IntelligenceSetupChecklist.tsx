import Link from 'next/link';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import RecommendedPresetButton from '@/components/settings/RecommendedPresetButton';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import {
  setupChecklist,
  setupRevisions,
  type SetupState,
} from '@/lib/intelligence/settings/setup-contract';

/**
 * Setup progress at the top of Settings → Intelligence: how many switch families are on, then each one
 * with its state, what it gives and a button to its setting. Managers also get the Recommended preset
 * while a preset item is off. Renders nothing once everything is on.
 */
export default function IntelligenceSetupChecklist({
  state,
  canManage,
}: {
  state: SetupState;
  canManage: boolean;
}) {
  const items = setupChecklist(state);
  const onCount = items.filter(item => item.on).length;
  if (onCount === items.length) return null;
  const presetPending = items.some(item => !item.on && item.inPreset);
  const percent = Math.round((onCount / items.length) * 100);
  return (
    <SettingsSection
      id="setup"
      title="Setup"
      description="The recommended set changes nothing about who is paged: no AUTO, noise controls only in shadow, no AI."
      action={
        canManage && presetPending ? (
          <RecommendedPresetButton revisions={setupRevisions(state)} />
        ) : undefined
      }
    >
      <div className="space-y-2 pt-4">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="font-medium text-foreground">
            <span className="tabular-nums">
              {onCount} of {items.length}
            </span>{' '}
            on
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">{percent}%</p>
        </div>
        <div
          role="progressbar"
          aria-label="Intelligence setup progress"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={onCount}
          aria-valuetext={`${onCount} of ${items.length} on`}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-200',
              toneClasses('ok').solid
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <ul className="divide-y divide-border" aria-label="Intelligence setup">
        {items.map(item => (
          <li
            key={item.id}
            data-setup-item={item.id}
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"
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
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-foreground">
                  {item.label}
                  <span className="sr-only">{item.on ? ' (on)' : ' (off)'}</span>
                  {!item.on && item.inPreset && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                      Recommended
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{item.benefit}</p>
              </div>
            </div>
            <Button
              asChild
              size="sm"
              variant={item.on ? 'ghost' : 'outline'}
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
    </SettingsSection>
  );
}
