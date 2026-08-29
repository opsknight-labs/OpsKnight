import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { ArrowRight, Clock, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

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
};

export default function CurrentCoverageDisplay({
  currentCoverage,
  nextCoverageChange,
  scheduleTimeZone,
}: CurrentCoverageDisplayProps) {
  const hasCoverage = currentCoverage.length > 0;

  return (
    <Card
      className={cn(
        'overflow-hidden shadow-sm transition-shadow hover:shadow-md',
        hasCoverage ? 'border-emerald-500/25' : 'border-amber-500/30'
      )}
    >
      <CardHeader
        className={cn(
          'border-b px-5 py-4 md:px-6',
          hasCoverage
            ? 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent'
            : 'border-amber-500/20 bg-gradient-to-br from-amber-500/12 via-amber-500/5 to-transparent'
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset',
                hasCoverage
                  ? 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-600 ring-amber-500/20 dark:text-amber-400'
              )}
            >
              {hasCoverage ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <TriangleAlert className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                On call now
              </p>
              <CardTitle className="mt-0.5 text-xl tracking-tight">
                {hasCoverage
                  ? currentCoverage.length === 1
                    ? currentCoverage[0].userName
                    : `${currentCoverage.length} responders`
                  : 'Coverage gap'}
              </CardTitle>
            </div>
          </div>
          <Badge variant={hasCoverage ? 'success' : 'warning'} className="shrink-0 px-2.5 py-1">
            {hasCoverage ? 'Covered' : 'Needs attention'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {hasCoverage ? (
          currentCoverage.length === 1 ? (
            <div className="flex items-center gap-3 px-5 py-3.5 md:px-6">
              <DirectUserAvatar
                avatarUrl={
                  currentCoverage[0].userAvatar ||
                  getDefaultAvatar(
                    currentCoverage[0].userGender,
                    currentCoverage[0].userId || currentCoverage[0].userName
                  )
                }
                name={currentCoverage[0].userName}
                size="md"
                className="h-9 w-9"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="info" size="xs">
                    {currentCoverage[0].layerName}
                  </Badge>
                  {currentCoverage[0].source === 'override' && (
                    <Badge variant="warning" size="xs">
                      {currentCoverage[0].isAdditiveOverride ? 'Extra coverage' : 'Override'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  On call until{' '}
                  {formatDateTime(new Date(currentCoverage[0].end), scheduleTimeZone, {
                    format: 'short',
                  })}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {currentCoverage.map(block => (
                <div key={block.id} className="flex items-center gap-3 px-5 py-3 md:px-6">
                  <DirectUserAvatar
                    avatarUrl={
                      block.userAvatar ||
                      getDefaultAvatar(block.userGender, block.userId || block.userName)
                    }
                    name={block.userName}
                    size="md"
                    className="h-9 w-9"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{block.userName}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="info" size="xs">
                        {block.layerName}
                      </Badge>
                      {block.source === 'override' && (
                        <Badge variant="warning" size="xs">
                          {block.isAdditiveOverride ? 'Extra coverage' : 'Override'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Until{' '}
                    {formatDateTime(new Date(block.end), scheduleTimeZone, { format: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="px-5 py-7">
            <p className="text-sm font-medium">No responder is currently scheduled.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Review rotation restrictions, layer dates, or add temporary coverage.
            </p>
          </div>
        )}

        <div className="border-t bg-muted/35 px-5 py-3 md:px-6">
          <div className="flex items-start gap-2 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            {nextCoverageChange ? (
              <div>
                <p className="font-medium">
                  Next handoff ·{' '}
                  {formatDateTime(new Date(nextCoverageChange.at), scheduleTimeZone, {
                    format: 'short',
                  })}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {currentCoverage.map(block => block.userName).join(', ') || 'No coverage'}
                  <ArrowRight className="h-3 w-3" />
                  {nextCoverageChange.coverage.map(block => block.userName).join(', ') ||
                    'No coverage'}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No upcoming handoff in this view.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
