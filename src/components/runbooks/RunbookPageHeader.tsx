import type { ComponentType, ReactNode } from 'react';
import PageHeader, { Breadcrumbs, type BreadcrumbItem } from '@/components/patterns/PageHeader';
import type { DetailStatItem } from '@/components/ui/DetailHeroBanner';

export type RunbookPageHeaderProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  /** Primary action (rightmost). */
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  /**
   * Trail above the header. The top bar already shows breadcrumbs from 1024px, so this
   * one only renders on smaller screens.
   */
  breadcrumbs?: BreadcrumbItem[];
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> | ReactNode;
  stats?: DetailStatItem[];
  statsPlacement?: 'inline' | 'bottom';
  alert?: ReactNode;
  className?: string;
};

/** Runbook page header: the shared `PageHeader` plus the runbooks "Beta" marker. */
export function RunbookPageHeader({
  title,
  description,
  badge,
  actions,
  secondaryActions,
  breadcrumbs,
  icon,
  stats,
  statsPlacement,
  alert,
  className,
}: RunbookPageHeaderProps) {
  return (
    <PageHeader
      title={title}
      description={description}
      icon={icon}
      breadcrumbs={
        breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} className="lg:hidden" />
        ) : undefined
      }
      badges={
        <>
          <span className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-2xs font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
            Beta
          </span>
          {badge}
        </>
      }
      primaryAction={actions}
      secondaryActions={secondaryActions}
      stats={stats}
      statsPlacement={statsPlacement}
      alert={alert}
      className={className}
    />
  );
}
