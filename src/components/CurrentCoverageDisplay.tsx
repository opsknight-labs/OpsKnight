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
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader
        className={cn(
          'border-b',
          hasCoverage
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-amber-500/20 bg-amber-500/5'
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl',
                hasCoverage
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : 'bg-amber-500/15 text-amber-600'
              )}
            >
              {hasCoverage ? (
                <ShieldCheck className="h-6 w-6" />
              ) : (
                <TriangleAlert className="h-6 w-6" />
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                On call now
              </p>
              <CardTitle className="mt-0.5 text-xl">
                {hasCoverage
                  ? currentCoverage.length === 1
                    ? currentCoverage[0].userName
                    : `${currentCoverage.length} responders`
                  : 'Coverage gap'}
              </CardTitle>
            </div>
          </div>
          <Badge variant={hasCoverage ? 'success' : 'warning'}>
            {hasCoverage ? 'Covered' : 'Needs attention'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {hasCoverage ? (
          <div className="divide-y">
            {currentCoverage.map(block => (
              <div key={block.id} className="flex items-center gap-3 px-5 py-4">
                <DirectUserAvatar
                  avatarUrl={
                    block.userAvatar ||
                    getDefaultAvatar(block.userGender, block.userId || block.userName)
                  }
                  name={block.userName}
                  size="md"
                  className="h-10 w-10"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{block.userName}</p>
                    {block.source === 'override' && (
                      <Badge variant="warning" size="xs">
                        {block.isAdditiveOverride ? 'Extra coverage' : 'Override'}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Until{' '}
                    {formatDateTime(new Date(block.end), scheduleTimeZone, { format: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-7">
            <p className="text-sm font-medium">No responder is currently scheduled.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Review rotation restrictions, layer dates, or add temporary coverage.
            </p>
          </div>
        )}

        <div className="border-t bg-muted/30 px-5 py-3">
          <div className="flex items-start gap-2 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            {nextCoverageChange ? (
              <div>
                <p className="font-medium">
                  Next change{' '}
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
              <p className="text-muted-foreground">No later coverage change in this window.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
