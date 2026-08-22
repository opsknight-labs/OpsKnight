'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { Clock, UserCheck, ShieldCheck, AlertTriangle } from 'lucide-react';
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
};

type CurrentCoverageDisplayProps = {
  initialBlocks: CoverageBlock[];
  scheduleTimeZone: string;
};

export default function CurrentCoverageDisplay({
  initialBlocks,
  scheduleTimeZone,
}: CurrentCoverageDisplayProps) {
  const formatTime = (date: Date) => {
    return formatDateTime(date, scheduleTimeZone, { format: 'time' });
  };

  const normalizedBlocks = initialBlocks.map(block => ({
    ...block,
    start: new Date(block.start),
    end: new Date(block.end),
  }));

  const [activeBlocks, setActiveBlocks] = useState(normalizedBlocks);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const calculateActive = () => {
      const now = new Date();
      setCurrentTime(now);
      const nowTime = now.getTime();
      const normalized = initialBlocks.map(block => ({
        ...block,
        start: new Date(block.start),
        end: new Date(block.end),
      }));
      const active = normalized.filter(block => {
        return block.start.getTime() <= nowTime && block.end.getTime() > nowTime;
      });
      setActiveBlocks(active);
    };
    calculateActive();
    const interval = setInterval(calculateActive, 30000);
    return () => clearInterval(interval);
  }, [initialBlocks]);

  const hasCoverage = activeBlocks.length > 0;

  return (
    <Card className="overflow-hidden border-slate-200/80">
      <CardHeader
        className={cn(
          'pb-3 border-b',
          hasCoverage ? 'bg-emerald-50/70 border-emerald-100' : 'bg-amber-50/70 border-amber-100'
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl',
                hasCoverage
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : 'bg-amber-500/15 text-amber-600'
              )}
            >
              {hasCoverage ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <AlertTriangle className="h-5 w-5" />
              )}
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">On-Call Now</CardTitle>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                <Clock className="h-3 w-3" />
                {formatTime(currentTime)}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={hasCoverage ? 'success' : 'warning'} size="xs">
              {hasCoverage ? 'Active' : 'No coverage'}
            </Badge>
            <Badge variant="outline" size="xs">
              {scheduleTimeZone}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 bg-white">
        {!hasCoverage ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <UserCheck className="h-5 w-5 text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700">No active responders</p>
            <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
              No shifts are currently scheduled. Check configuration.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {activeBlocks.map(block => (
              <div
                key={block.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <DirectUserAvatar
                  avatarUrl={
                    block.userAvatar ||
                    getDefaultAvatar(block.userGender, block.userId || block.userName)
                  }
                  name={block.userName}
                  size="sm"
                  className="h-9 w-9 ring-1 ring-slate-200 shadow-sm"
                  fallbackClassName="bg-emerald-50 text-emerald-700"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800 truncate">
                      {block.userName}
                    </h4>
                    <Badge variant="secondary" size="xs">
                      {block.layerName}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Ends {formatTime(new Date(block.end))}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {hasCoverage && (
          <div className="bg-slate-50 px-4 py-2 border-t border-slate-100 text-center">
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              Updates every 30 seconds
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
