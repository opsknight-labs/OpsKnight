import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { FileText, ArrowUpRight, Plus, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type IncidentPostmortemCardProps = {
  incidentId: string;
  postmortemStatus: string | null;
  canManage: boolean;
  className?: string;
};

export default function IncidentPostmortemCard({
  incidentId,
  postmortemStatus,
  canManage,
  className,
}: IncidentPostmortemCardProps) {
  const isFiled = Boolean(postmortemStatus);
  const isPublished = postmortemStatus === 'PUBLISHED';
  const href = `/postmortems/${incidentId}`;

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all',
        className
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <FileText className="h-4 w-4 shrink-0" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 whitespace-nowrap">
            Postmortem
          </h3>
        </div>

        {postmortemStatus ? (
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border',
              isPublished
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
            )}
          >
            {postmortemStatus}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
            Pending
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-3.5 space-y-3">
        {isFiled ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              {isPublished ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>Post-incident review published</span>
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>Draft review in progress</span>
                </>
              )}
            </div>

            <Link href={href} className="block">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between h-8 text-xs font-medium border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>{isPublished ? 'View Full Report' : 'Continue Review'}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Document root causes, lessons learned, and track action items to prevent recurrence.
            </p>

            {canManage ? (
              <Link href={href} className="block">
                <Button size="sm" className="w-full gap-1.5 h-8 text-xs font-semibold shadow-xs">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Postmortem</span>
                </Button>
              </Link>
            ) : (
              <p className="text-[11px] text-slate-400 italic">
                Postmortem not started by responders yet.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
