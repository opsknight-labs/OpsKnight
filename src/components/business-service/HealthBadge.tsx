/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier, urgency), never request input */
import {
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  OctagonX,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { BusinessServiceLifecycle, BusinessServiceTier } from '@prisma/client';
import { RelativeTime } from '@/components/patterns';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import type { BsStatus } from '@/lib/business-services/contract';
import { cn } from '@/lib/utils';

type StatusMeta = { label: string; tone: ToneKey; icon: LucideIcon; rank: number };

/** One business-service status vocabulary for catalog, overview, dashboard and mobile. */
export const BS_STATUS_META: Readonly<Record<BsStatus, StatusMeta>> = {
  OPERATIONAL: { label: 'Operational', tone: 'ok', icon: CheckCircle2, rank: 0 },
  UNKNOWN: { label: 'Unknown', tone: 'neutral', icon: CircleHelp, rank: 1 },
  MAINTENANCE: { label: 'Maintenance', tone: 'info', icon: Wrench, rank: 2 },
  DEGRADED: { label: 'Degraded', tone: 'elevated', icon: TriangleAlert, rank: 3 },
  PARTIAL_OUTAGE: { label: 'Partial outage', tone: 'orange', icon: CircleAlert, rank: 4 },
  MAJOR_OUTAGE: { label: 'Major outage', tone: 'critical', icon: OctagonX, rank: 5 },
};

/** Worst first (highest rank). Ties keep the caller's order (Array.prototype.sort is stable). */
export const byWorstStatus = (a: { status: BsStatus }, b: { status: BsStatus }) =>
  BS_STATUS_META[b.status].rank - BS_STATUS_META[a.status].rank;

export const CRITICALITY_LABEL: Readonly<Record<BusinessServiceTier, string>> = {
  TIER_0: 'Tier 0',
  TIER_1: 'Tier 1',
  TIER_2: 'Tier 2',
  TIER_3: 'Tier 3',
};

export const LIFECYCLE_LABEL: Readonly<Record<BusinessServiceLifecycle, string>> = {
  ACTIVE: 'Active',
  BETA: 'Beta',
  DEPRECATED: 'Deprecated',
  RETIRED: 'Retired',
};

export const CRITICALITY_HINT: Readonly<Record<BusinessServiceTier, string>> = {
  TIER_0: 'Mission critical',
  TIER_1: 'Business critical',
  TIER_2: 'Important',
  TIER_3: 'Supporting',
};

/**
 * Status pill (icon + label, never colour alone) with an optional "since" time. `solid` is for a row's
 * primary signal, per DESIGN.md; everything else stays soft.
 */
export default function HealthBadge({
  status,
  since,
  variant = 'soft',
  className,
}: {
  status: BsStatus;
  since?: Date | string | null;
  variant?: 'soft' | 'solid';
  className?: string;
}) {
  const meta = BS_STATUS_META[status] ?? BS_STATUS_META.UNKNOWN;
  const recipe = toneClasses(meta.tone);
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span
        className={cn(
          'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs font-semibold',
          variant === 'solid' ? recipe.filled : recipe.soft
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {meta.label}
      </span>
      {since && (
        <span className="text-xs text-muted-foreground tabular-nums">
          since <RelativeTime date={since} />
        </span>
      )}
    </span>
  );
}
