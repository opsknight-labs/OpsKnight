import type { ReactNode } from 'react';
import type { NavigationSummary } from '@/lib/runbooks/presentation/contracts';
import { cn } from '@/lib/utils';
import { RunbookModuleNav } from './RunbookModuleNav';
import { RunbookPageHeader, type RunbookPageHeaderProps } from './RunbookPageHeader';

/**
 * Frame shared by every `/runbooks/**` route: the page header, the Library / Executions /
 * Agents / Health navigation, an optional section sub-navigation and the page content.
 */
export function RunbooksPageShell({
  header,
  navigation,
  subNav,
  navClassName,
  as: Element = 'div',
  className,
  children,
}: {
  header: RunbookPageHeaderProps;
  navigation?: NavigationSummary;
  subNav?: ReactNode;
  /** e.g. `static` when the page content owns the sticky slot. */
  navClassName?: string;
  as?: 'div' | 'main';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Element
      className={cn(
        'mx-auto w-full max-w-[1600px] space-y-4 px-4 py-6 md:space-y-5 md:px-6 md:py-8',
        className
      )}
    >
      <RunbookPageHeader {...header} />
      <RunbookModuleNav summary={navigation} className={navClassName} />
      {subNav}
      {children}
    </Element>
  );
}
