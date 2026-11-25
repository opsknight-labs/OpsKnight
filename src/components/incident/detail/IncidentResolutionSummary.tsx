import type { Incident } from '@prisma/client';
import Link from 'next/link';
import { CheckCircle2, FileText } from 'lucide-react';
import { toneClasses } from '@/components/patterns/status-tone';
import { formatDurationShort } from '@/lib/mobile-time';
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
  resolutionNote: ResolutionNote | null;
  postmortemStatus?: string | null;
  /** Where the postmortem opens (the mobile app links by postmortem id). */
  postmortemHref: string;
};

/**
 * One line for a resolved incident: who resolved it, how long it ran, the resolution note (whole on hover)
 * and the postmortem's state. SLA results live on the title card's SLA chips; starting a postmortem is in
 * the command bar (bottom bar on phones).
 */
export default function IncidentResolutionSummary({
  incident,
  resolutionNote,
  postmortemStatus,
  postmortemHref,
}: IncidentResolutionSummaryProps) {
  const note = resolutionNote?.content.replace(/^Resolution:\s*/, '').trim() || null;
  const ranFor = incident.resolvedAt
    ? formatDurationShort(incident.createdAt, incident.resolvedAt)
    : null;
  return (
    <section
      aria-label="Resolution"
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3.5 py-2.5 text-xs',
        toneClasses('ok').soft
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        Resolved
      </span>
      <span className="text-foreground/80">
        {resolutionNote?.user ? `by ${resolutionNote.user.name}` : null}
        {ranFor ? `${resolutionNote?.user ? ' · ' : ''}ran ${ranFor}` : null}
      </span>
      <span className="min-w-0 flex-1 basis-48 truncate text-foreground" title={note ?? undefined}>
        {note ? `“${note}”` : <em className="text-muted-foreground">No resolution note</em>}
      </span>
      {postmortemStatus && (
        <Link
          href={postmortemHref}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Postmortem {postmortemStatus.toLowerCase()}
        </Link>
      )}
    </section>
  );
}
