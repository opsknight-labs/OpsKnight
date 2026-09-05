import type { Incident, Service } from '@prisma/client';
import SLAIndicator from '../SLAIndicator';
import EscalationStatusBadge from '../EscalationStatusBadge';
import { Activity, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type IncidentResponseHealthProps = {
  incident: Incident;
  service: Service & { policy?: { name: string } | null };
  escalationStatus: string | null | undefined;
  currentEscalationStep: number | null | undefined;
  nextEscalationAt: Date | null | undefined;
  className?: string;
};

export default function IncidentResponseHealth({
  incident,
  service,
  escalationStatus,
  currentEscalationStep,
  nextEscalationAt,
  className,
}: IncidentResponseHealthProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all flex flex-col',
        className
      )}
    >
      {/* Header bar matching IncidentDescriptionCard */}
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-slate-500 shrink-0" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Response Health &amp; SLAs
          </h3>
        </div>
        {service?.policy?.name && (
          <span
            className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[150px]"
            title={service.policy.name}
          >
            {service.policy.name}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-5 md:p-6 space-y-4">
        <SLAIndicator incident={incident} service={service} showDetails />

        {escalationStatus && escalationStatus !== 'COMPLETED' && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
              <ShieldAlert className="h-3 w-3" /> Escalation Status
            </p>
            <EscalationStatusBadge
              status={escalationStatus}
              currentStep={currentEscalationStep}
              nextEscalationAt={nextEscalationAt}
              size="md"
            />
          </div>
        )}
      </div>
    </div>
  );
}
