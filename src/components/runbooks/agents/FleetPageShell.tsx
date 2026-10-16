import type { ComponentType, ReactNode } from 'react';
import type { NavigationSummary } from '@/lib/runbooks/presentation/contracts';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { FleetSubNav } from './FleetSubNav';

export function FleetPageShell({
  title,
  description,
  section,
  icon,
  actions,
  navigation,
  canManageSecrets,
  children,
}: {
  title: string;
  description: ReactNode;
  section?: string;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  actions?: ReactNode;
  navigation: NavigationSummary;
  canManageSecrets: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <RunbookPageHeader
        title={title}
        description={description}
        actions={actions}
        icon={icon}
        breadcrumbs={
          section
            ? [
                { label: 'Runbooks', href: '/runbooks' },
                { label: 'Execution Infrastructure', href: '/runbooks/agents' },
                { label: section },
              ]
            : undefined
        }
      />
      <RunbookModuleNav summary={navigation} />
      <div className="space-y-6">
        <FleetSubNav canManageSecrets={canManageSecrets} />
        {children}
      </div>
    </div>
  );
}
