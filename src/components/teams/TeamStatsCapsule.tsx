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
        'grid grid-cols-3 gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1.5 backdrop-blur-xs shadow-xs lg:min-w-[330px]',
        className
      )}
    >
      {/* Responders / Members */}
      <div className="min-w-0 rounded-lg px-3 py-2 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Members</p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-bold text-white">
          <UserCheck className="h-3.5 w-3.5" /> {totalMembers}
        </p>
      </div>

      {/* Services */}
      <div className="min-w-0 rounded-lg border-x border-zinc-800/80 px-3 py-2 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Services</p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-bold text-white">
          <Shield className="h-3.5 w-3.5" /> {totalServices}
        </p>
      </div>

      {/* Status */}
      <div className="min-w-0 rounded-lg px-3 py-2 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Status</p>
        <p
          className={cn(
            'mt-1 flex items-center justify-center gap-1.5 text-sm font-bold',
            isConfigured ? 'text-emerald-400' : 'text-amber-400'
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isConfigured ? 'Configured' : 'Needs setup'}
        </p>
      </div>
    </div>
  );
}
