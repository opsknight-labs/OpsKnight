import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import { BADGE_BASE_CLASS, badgeSizeClass } from '@/components/patterns/StatusBadge';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';

/** Connection state shared by the integrations hub, the settings home and each provider page. */
export type IntegrationState = 'connected' | 'not_connected' | 'error';

function stateDisplay(state: IntegrationState) {
  switch (state) {
    case 'connected':
      return { label: 'Connected', Icon: CheckCircle2 };
    case 'error':
      return { label: "Couldn't check", Icon: AlertTriangle };
    default:
      return { label: 'Not connected', Icon: CircleDashed };
  }
}

/**
 * Icon + label pill for an integration's state. `onDark` renders the variant for the
 * always-dark PageHeader surface.
 */
export function IntegrationStatusBadge({
  state,
  label,
  onDark = false,
  className,
}: {
  state: IntegrationState;
  /** Overrides the default label ("Connected (acme)", "3 active"). */
  label?: string;
  onDark?: boolean;
  className?: string;
}) {
  const { label: defaultLabel, Icon } = stateDisplay(state);
  const text = label ?? defaultLabel;
  if (onDark) {
    return (
      <span
        className={cn(
          pageHeaderBadgeClass,
          state === 'connected' && 'border-emerald-500/40 text-emerald-300',
          state === 'error' && 'border-amber-500/40 text-amber-300',
          className
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {text}
      </span>
    );
  }
  const tone = state === 'connected' ? 'ok' : state === 'error' ? 'elevated' : null;
  return (
    <span className={cn(BADGE_BASE_CLASS, badgeSizeClass('sm'), toneClasses(tone).soft, className)}>
      <Icon aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}
