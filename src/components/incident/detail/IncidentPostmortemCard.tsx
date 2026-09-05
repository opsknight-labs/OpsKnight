import Link from 'next/link';
import StatusBadge from '../StatusBadge';
import { Button } from '@/components/ui/shadcn/button';
import { FileText, ChevronRight } from 'lucide-react';

type IncidentPostmortemCardProps = {
  incidentId: string;
  postmortemStatus: string | null;
  canManage: boolean;
};

export default function IncidentPostmortemCard({
  incidentId,
  postmortemStatus,
  canManage,
}: IncidentPostmortemCardProps) {
  const href = `/postmortems/${incidentId}`;
  const label = !postmortemStatus
    ? canManage
      ? 'Create postmortem'
      : 'Postmortem not started'
    : 'Continue';

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-2">
          <FileText className="h-3 w-3" /> Post-Incident
        </h3>
        {postmortemStatus && <StatusBadge status={postmortemStatus} size="sm" />}
      </div>
      {!postmortemStatus && !canManage ? (
        <p className="text-xs text-emerald-700 italic">{label}</p>
      ) : (
        <Link href={href}>
          <Button
            className="w-full justify-between group bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
            variant="outline"
          >
            <span>{label}</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
      )}
    </div>
  );
}
