import { Shield, UserCheck, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type TeamStatsCapsuleProps = {
  totalTeams: number;
  totalMembers: number;
  totalServices: number;
  configuredCount?: number;
  className?: string;
};

export default function TeamStatsCapsule({
  totalTeams,
  totalMembers,
  totalServices,
  configuredCount: _configuredCount,
  className,
}: TeamStatsCapsuleProps) {
  const isConfigured = totalTeams > 0 && totalMembers > 0;

  return (
    <div
      className={cn(
        'grid grid-cols-3 gap-1.5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-1.5 backdrop-blur-sm lg:min-w-[330px]',
        className
      )}
    >
      {/* Responders / Members */}
      <div className="min-w-0 rounded-md px-3 py-2 text-center">
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
          Members
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
          <UserCheck className="h-3.5 w-3.5" /> {totalMembers}
        </p>
      </div>

      {/* Services */}
      <div className="min-w-0 rounded-md border-x border-primary-foreground/20 px-3 py-2 text-center">
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
          Services
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground">
          <Shield className="h-3.5 w-3.5" /> {totalServices}
        </p>
      </div>

      {/* Status */}
      <div className="min-w-0 rounded-md px-3 py-2 text-center">
        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
          Status
        </p>
        <p
          className={cn(
            'mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary-foreground',
            isConfigured ? 'text-emerald-100' : 'text-amber-100'
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isConfigured ? 'Configured' : 'Needs setup'}
        </p>
      </div>
    </div>
  );
}
