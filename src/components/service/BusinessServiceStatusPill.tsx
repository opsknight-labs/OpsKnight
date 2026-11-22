import { cn } from '@/lib/utils';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';

function presentation(status: string): { label: string; tone: ToneKey } {
  switch (status) {
    case 'MAJOR_OUTAGE':
      return { label: 'Major outage', tone: 'critical' };
    case 'PARTIAL_OUTAGE':
      return { label: 'Partial outage', tone: 'elevated' };
    case 'DEGRADED':
      return { label: 'Degraded', tone: 'elevated' };
    case 'MAINTENANCE':
      return { label: 'Maintenance', tone: 'info' };
    default:
      return { label: 'Operational', tone: 'ok' };
  }
}

export default function BusinessServiceStatusPill({
  status,
  dotOnly = false,
}: {
  status: string;
  dotOnly?: boolean;
}) {
  const { label, tone } = presentation(status);
  const recipe = toneClasses(tone);
  if (dotOnly) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', recipe.solid)}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs font-semibold',
        recipe.soft
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', recipe.solid)} />
      {label}
    </span>
  );
}
