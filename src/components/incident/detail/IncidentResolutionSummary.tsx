import type { Incident, Service } from '@prisma/client';
import NoteCard from '../NoteCard';
import SLAIndicator from '../SLAIndicator';
import { CheckCircle2 } from 'lucide-react';

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
};

export default function IncidentResolutionSummary({
  incident,
  service,
  resolutionNote,
}: IncidentResolutionSummaryProps) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        <h2 className="text-base font-bold text-emerald-900">Resolved</h2>
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
        <p className="text-sm text-emerald-700 italic">No resolution note was recorded.</p>
      )}

      <div className="pt-2 border-t border-emerald-100">
        <SLAIndicator incident={incident} service={service} showDetails />
      </div>
    </div>
  );
}
