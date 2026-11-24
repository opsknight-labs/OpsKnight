/* eslint-disable security/detect-object-injection -- keyed by the typed status enum, never request input */
import {
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  OctagonX,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import type { BsStatus } from '@/lib/business-services/contract';
import { cn } from '@/lib/utils';

// shortcut: mirrors business-service/HealthBadge (P2); switch to it once both branches have merged.
export const GRAPH_STATUS_META: Readonly<
  Record<BsStatus, { label: string; tone: ToneKey; icon: LucideIcon }>
> = {
  OPERATIONAL: { label: 'Operational', tone: 'ok', icon: CheckCircle2 },
  UNKNOWN: { label: 'Unknown', tone: 'neutral', icon: CircleHelp },
  MAINTENANCE: { label: 'Maintenance', tone: 'info', icon: Wrench },
  DEGRADED: { label: 'Degraded', tone: 'elevated', icon: TriangleAlert },
  PARTIAL_OUTAGE: { label: 'Partial outage', tone: 'orange', icon: CircleAlert },
  MAJOR_OUTAGE: { label: 'Major outage', tone: 'critical', icon: OctagonX },
};

/** Status pill: icon and label, never colour alone. */
export default function GraphHealthBadge({
  status,
  className,
}: {
  status: BsStatus;
  className?: string;
}) {
  const meta = GRAPH_STATUS_META[status] ?? GRAPH_STATUS_META.UNKNOWN;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs font-semibold',
        toneClasses(meta.tone).soft,
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
