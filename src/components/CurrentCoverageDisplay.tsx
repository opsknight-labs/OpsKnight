'use client';

import Link from 'next/link';
import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { useTimezone } from '@/contexts/TimezoneContext';
import { Clock, ShieldCheck, TriangleAlert, UserRoundCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type CoverageBlock = {
  id: string;
  userId?: string;
  userName: string;
  userAvatar?: string | null;
  userGender?: string | null;
  layerName: string;
  start: Date | string;
  end: Date | string;
  source?: 'rotation' | 'override';
  isAdditiveOverride?: boolean;
};

type CurrentCoverageDisplayProps = {
  currentCoverage: CoverageBlock[];
  nextCoverageChange: { at: Date | string; coverage: CoverageBlock[] } | null;
  scheduleTimeZone: string;
  scheduleId?: string;
  canCreateOverride?: boolean;
  coverageGap?: boolean;
  activeOverridesCount?: number;
  healthContent?: ReactNode;
};

export default function CurrentCoverageDisplay({
  currentCoverage,
  nextCoverageChange,
  scheduleTimeZone,
  scheduleId,
  canCreateOverride = false,
  coverageGap = false,
  activeOverridesCount = 0,
  healthContent,
}: CurrentCoverageDisplayProps) {
  const { userTimeZone, browserTimeZone } = useTimezone();
  const viewerTz = browserTimeZone || userTimeZone || scheduleTimeZone;
  const isDifferentTz = Boolean(viewerTz && viewerTz !== scheduleTimeZone);

  const hasCoverage = currentCoverage.length > 0;

  return (
    <Card className="flex flex-col justify-between overflow-hidden border-border/70 shadow-sm">
      <div>
        {/* Compact Header */}
        <CardHeader className="border-b bg-muted/20 px-4 py-2.5 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset',
                  hasCoverage && !coverageGap
                    ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
                    : 'bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400'
                )}
              >
                {hasCoverage && !coverageGap ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <TriangleAlert className="h-4 w-4" />
                )}
              </div>
              <CardTitle className="text-sm font-semibold">On-call now</CardTitle>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge
                variant={hasCoverage && !coverageGap ? 'success' : 'warning'}
                size="xs"
                className="gap-1 px-2 py-0.5 text-[10px]"
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    hasCoverage && !coverageGap ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  )}
                />
                {hasCoverage && !coverageGap ? 'Covered' : 'Needs attention'}
              </Badge>
              <Badge
                variant="outline"
                size="xs"
                className="px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {scheduleTimeZone}
              </Badge>
            </div>
          </div>
        </CardHeader>

        {/* Compact Content */}
        <CardContent className="p-3.5 sm:p-4 space-y-2.5">
          {hasCoverage ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <DirectUserAvatar
                  avatarUrl={
                    currentCoverage[0].userAvatar ||
                    getDefaultAvatar(
                      currentCoverage[0].userGender,
                      currentCoverage[0].userId || currentCoverage[0].userName
                    )
                  }
                  name={currentCoverage[0].userName}
                  size="sm"
                  className="h-9 w-9 shrink-0 ring-1.5 ring-primary/20"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="truncate text-sm font-bold text-foreground">
                      {currentCoverage[0].userName}
                    </span>
                    <Badge variant="secondary" size="xs" className="text-[10px] px-1.5 py-0">
                      {currentCoverage[0].layerName}
                    </Badge>
                    {currentCoverage[0].source === 'override' && (
                      <Badge variant="warning" size="xs" className="text-[10px] px-1.5 py-0">
                        {currentCoverage[0].isAdditiveOverride ? 'Extra coverage' : 'Override'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                    <Clock className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                    <span>
                      Until{' '}
                      <span className="font-semibold text-foreground">
                        {formatDateTime(new Date(currentCoverage[0].end), scheduleTimeZone, {
                          format: 'short',
                        })}
                      </span>
                      {isDifferentTz && (
                        <span
                          className="text-muted-foreground font-normal ml-1"
                          title={`Formatted in your local timezone (${viewerTz})`}
                        >
                          (
                          <strong className="font-medium text-foreground/80">
                            {formatDateTime(new Date(currentCoverage[0].end), viewerTz, {
                              format: 'time',
                            })}
                          </strong>{' '}
                          local)
                        </span>
                      )}
                    </span>
                  </p>
                </div>
              </div>

              {/* Cover Shift Quick Action */}
              {scheduleId && canCreateOverride && (
                <Link
                  href={`/schedules/${scheduleId}?tab=overrides`}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors shrink-0"
                >
                  <UserRoundCog className="h-3 w-3" />
                  <span>Cover shift</span>
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-center">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                No responder scheduled
              </p>
            </div>
          )}

          {/* Next Handoff Bar */}
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
              <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
              {nextCoverageChange ? (
                <div className="flex items-center gap-1 truncate">
                  <span className="text-muted-foreground font-medium">Next:</span>
                  <span className="text-foreground font-semibold truncate">
                    {nextCoverageChange.coverage.map(b => b.userName).join(', ') || 'Gap'}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground">No upcoming handoff</span>
              )}
            </div>
            {nextCoverageChange && (
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums font-medium">
                {formatDateTime(new Date(nextCoverageChange.at), scheduleTimeZone, {
                  format: 'short',
                })}
                {isDifferentTz && (
                  <span
                    className="opacity-70 ml-1"
                    title={`Local time: ${formatDateTime(new Date(nextCoverageChange.at), viewerTz, { format: 'datetime' })}`}
                  >
                    (
                    {formatDateTime(new Date(nextCoverageChange.at), viewerTz, {
                      format: 'time',
                    })}
                    )
                  </span>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </div>

      {/* Bottom Health/Alerts Sub-strip */}
      {healthContent && (
        <div className="border-t bg-muted/10 px-3.5 py-2 sm:px-4 text-xs">{healthContent}</div>
      )}
    </Card>
  );
}
