import type { ComponentType, ReactNode } from 'react';
import type { NavigationSummary } from '@/lib/runbooks/presentation/contracts';
import DetailHeroBanner, { type DetailStatItem } from '@/components/ui/DetailHeroBanner';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { FleetSubNav } from './FleetSubNav';
import { Activity, Server, ShieldCheck } from 'lucide-react';

export function FleetPageShell({
  title,
  description,
  section: _section,
  icon: Icon,
  actions,
  navigation,
  canManageSecrets,
  stats,
  children,
}: {
  title: string;
  description: ReactNode;
  section?: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  actions?: ReactNode;
  navigation: NavigationSummary;
  canManageSecrets: boolean;
  stats?: DetailStatItem[];
  children: ReactNode;
}) {
  const defaultStats: DetailStatItem[] = [
    {
      label: 'Online Agents',
      value: navigation.onlineAgents ?? 0,
      icon: <Server className="h-3.5 w-3.5 text-emerald-200" />,
      valueClassName:
        navigation.onlineAgents && navigation.onlineAgents > 0
          ? 'text-emerald-200 font-bold'
          : undefined,
      href: '/runbooks/agents?status=ONLINE',
    },
    {
      label: 'Active Executions',
      value: navigation.activeExecutions ?? 0,
      icon: <Activity className="h-3.5 w-3.5 text-sky-200" />,
      valueClassName:
        navigation.activeExecutions && navigation.activeExecutions > 0
          ? 'text-sky-200 font-bold'
          : undefined,
      href: '/runbooks/executions',
    },
    {
      label: 'Fleet Health',
      value: navigation.health,
      icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-200" />,
      valueClassName:
        navigation.health === 'HEALTHY'
          ? 'text-emerald-200 font-bold'
          : navigation.health === 'DEGRADED'
            ? 'text-amber-200 font-bold'
            : undefined,
      href: '/runbooks/health',
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-3 sm:px-4 md:px-6 py-4 md:py-5">
      <DetailHeroBanner
        tag="Execution Infrastructure"
        title={title}
        icon={
          Icon ? (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
              <Icon className="h-6 w-6" aria-hidden />
            </div>
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
              <Server className="h-6 w-6" aria-hidden />
            </div>
          )
        }
        subtitle={
          typeof description === 'string' ? (
            <p className="text-xs text-primary-foreground/85 leading-relaxed">{description}</p>
          ) : (
            description
          )
        }
        actions={actions}
        statsPlacement="bottom"
        stats={stats || defaultStats}
      />
      <RunbookModuleNav summary={navigation} />
      <div className="space-y-4 md:space-y-5">
        <FleetSubNav canManageSecrets={canManageSecrets} />
        {children}
      </div>
    </div>
  );
}
