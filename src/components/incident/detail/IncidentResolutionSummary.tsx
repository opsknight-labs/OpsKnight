import type { Incident, Service } from '@prisma/client';
import Link from 'next/link';
import NoteCard from '../NoteCard';
import SLAIndicator from '../SLAIndicator';
import { Button } from '@/components/ui/shadcn/button';
import { CheckCircle2, FileText, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type ResolutionNote = {
  content: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
};

type IncidentResolutionSummaryProps = {
  incident: Incident;
  service: Service;
  resolutionNote: ResolutionNote | null;
  postmortemStatus?: string | null;
  canManage?: boolean;
};

export default function IncidentResolutionSummary({
  incident,
  service,
  resolutionNote,
  postmortemStatus,
  canManage = false,
}: IncidentResolutionSummaryProps) {
  const isPostmortemPublished = postmortemStatus === 'PUBLISHED';
  const hasPostmortem = Boolean(postmortemStatus);

  return (
    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-900/50 p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <h2 className="text-base font-bold text-emerald-950 dark:text-emerald-200">
            Incident Resolved
          </h2>
        </div>

        {/* Postmortem Action Option in Resolution Banner */}
        <div className="flex items-center gap-2 shrink-0">
          {hasPostmortem ? (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase border',
                  isPostmortemPublished
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-300 dark:border-emerald-700'
                    : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/60 dark:text-amber-300 dark:border-amber-700'
                )}
              >
                Postmortem {postmortemStatus}
              </span>

              <Link href={`/postmortems/${incident.id}`}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 bg-white dark:bg-slate-900 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>View Postmortem</span>
                </Button>
              </Link>
            </div>
          ) : (
            canManage && (
              <Link href={`/postmortems/${incident.id}`}>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Postmortem</span>
                </Button>
              </Link>
            )
          )}
        </div>
      </div>

      {resolutionNote ? (
        <NoteCard
          content={resolutionNote.content}
          userId={resolutionNote.user?.id}
          userName={resolutionNote.user?.name ?? 'Unknown responder'}
          userAvatar={resolutionNote.user?.avatarUrl}
          userGender={resolutionNote.user?.gender}
          createdAt={resolutionNote.createdAt}
          isResolution
        />
      ) : (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 italic">
          No resolution note was recorded.
        </p>
      )}

      <div className="pt-2 border-t border-emerald-100 dark:border-emerald-900/40">
        <SLAIndicator incident={incident} service={service} showDetails />
      </div>
    </div>
  );
}
