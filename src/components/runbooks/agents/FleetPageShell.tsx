import type { ComponentType, ReactNode } from 'react';
import type { NavigationSummary } from '@/lib/runbooks/presentation/contracts';
import type { DetailStatItem } from '@/components/ui/DetailHeroBanner';
import { RunbooksPageShell } from '@/components/runbooks/RunbooksPageShell';
import { FleetSubNav } from './FleetSubNav';
import { Activity, Server, ShieldCheck } from 'lucide-react';

export function FleetPageShell({
  title,
  description,
  section,
  icon: Icon = Server,
  actions,
  navigation,
  canManageSecrets,
  stats,
  children,
}: {
  title: string;
  description: ReactNode;
  /** Sub-section label for the breadcrumb trail (Pools, Secrets, Security); omit on the Agents root. */
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
      icon: <Server className="h-3.5 w-3.5 text-emerald-200" aria-hidden="true" />,
      valueClassName:
        navigation.onlineAgents && navigation.onlineAgents > 0
          ? 'text-emerald-200 font-bold'
          : undefined,
      href: '/runbooks/agents?status=ONLINE',
    },
    {
      label: 'Active Executions',
      value: navigation.activeExecutions ?? 0,
      icon: <Activity className="h-3.5 w-3.5 text-sky-200" aria-hidden="true" />,
      valueClassName:
        navigation.activeExecutions && navigation.activeExecutions > 0
          ? 'text-sky-200 font-bold'
          : undefined,
      href: '/runbooks/executions',
    },
    {
      label: 'Fleet Health',
      value: navigation.health,
      icon: <ShieldCheck className="h-3.5 w-3.5 text-emerald-200" aria-hidden="true" />,
      valueClassName:
        navigation.health === 'HEALTHY'
          ? 'text-emerald-200 font-bold'
          : navigation.health === 'DEGRADED'
            ? 'text-amber-200 font-bold'
            : undefined,
      href: '/runbooks/health',
    },
  ];

  const breadcrumbs = section
    ? [
        { label: 'Runbooks', href: '/runbooks' },
        { label: 'Agents', href: '/runbooks/agents' },
        { label: section },
      ]
    : [{ label: 'Runbooks', href: '/runbooks' }, { label: 'Agents' }];

  return (
    <RunbooksPageShell
      navigation={navigation}
      subNav={<FleetSubNav canManageSecrets={canManageSecrets} />}
      header={{
        breadcrumbs,
        title,
        icon: Icon,
        description,
        actions,
        statsPlacement: 'bottom',
        stats: stats || defaultStats,
      }}
    >
      {children}
    </RunbooksPageShell>
  );
}
