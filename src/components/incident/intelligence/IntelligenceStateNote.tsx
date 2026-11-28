import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import IncidentAiSummary from '@/components/incident/IncidentAiSummary';
import { Button } from '@/components/ui/shadcn/button';
import {
  incidentStateNote,
  type IncidentIntelligenceMode,
} from '@/lib/intelligence/incident-ux/state-note';

/**
 * The incident page's intelligence card is never blank. Off or only watching: one plain sentence and, for
 * administrators, the next step. On without a written briefing: the on-request summary, generated only when
 * someone asks (so there is no surprise cost) and never saved.
 */
export default function IntelligenceStateNote({
  incidentId,
  mode,
  canManage,
  canPostNote,
}: {
  incidentId: string;
  mode: IncidentIntelligenceMode;
  canManage: boolean;
  canPostNote: boolean;
}) {
  const note = incidentStateNote(mode, canManage);
  if (note.kind === 'summary')
    return <IncidentAiSummary incidentId={incidentId} canPostNote={canPostNote} />;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
    >
      <p className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        {note.text}
      </p>
      {note.action && (
        <Button asChild size="sm" variant="outline" className="min-h-11 sm:min-h-9">
          <Link href={note.action.href}>{note.action.label}</Link>
        </Button>
      )}
    </div>
  );
}
