import Link from 'next/link';
import { CheckCircle2, Circle } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import RecommendedPresetButton from '@/components/settings/RecommendedPresetButton';
import {
  setupChecklist,
  setupRevisions,
  type SetupState,
} from '@/lib/intelligence/settings/setup-contract';

/**
 * Setup checklist at the top of Settings → Intelligence: each switch family, what it gives, whether it is on
 * and where to turn it on. Managers also get the Recommended preset while a preset item is off. Renders
 * nothing once everything is on.
 */
export default function IntelligenceSetupChecklist({
  state,
  canManage,
}: {
  state: SetupState;
  canManage: boolean;
}) {
  const items = setupChecklist(state);
  const off = items.filter(item => !item.on);
  if (off.length === 0) return null;
  const presetPending = off.some(item => item.inPreset);
  return (
    <SettingsSection
      id="setup"
      title="Setup"
      description={`${items.length - off.length} of ${items.length} on. The recommended set is deterministic and changes nothing about who is paged: no AUTO, noise controls only in shadow, no AI.`}
      action={
        canManage && presetPending ? (
          <RecommendedPresetButton revisions={setupRevisions(state)} />
        ) : undefined
      }
    >
      <ul className="divide-y divide-border" aria-label="Intelligence setup">
        {items.map(item => (
          <li key={item.id} data-setup-item={item.id} className="flex items-start gap-3 py-3">
            {item.on ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-ok" aria-hidden="true" />
            ) : (
              <Circle
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium">
                {item.label}
                <span className="sr-only">{item.on ? ' (on)' : ' (off)'}</span>
              </p>
              <p className="text-sm text-muted-foreground">{item.benefit}</p>
            </div>
            {!item.on && (
              <Link
                href={item.href}
                aria-label={`Turn on ${item.label}`}
                className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Turn on
              </Link>
            )}
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
