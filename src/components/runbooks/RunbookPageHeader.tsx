import type { ComponentType, ReactNode } from 'react';
import PageHeader from '@/components/patterns/PageHeader';

export type RunbookPageHeaderProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className?: string;
};

/** Runbook page header: the shared `PageHeader` plus the runbooks "Beta" marker. */
export function RunbookPageHeader({
  title,
  description,
  badge,
  actions,
  breadcrumbs,
  icon,
  className,
}: RunbookPageHeaderProps) {
  return (
    <PageHeader
      title={title}
      description={description}
      icon={icon}
      breadcrumbs={breadcrumbs && breadcrumbs.length > 0 ? breadcrumbs : undefined}
      badges={
        <>
          <span className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-2xs font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
            Beta
          </span>
          {badge}
        </>
      }
      primaryAction={actions}
      className={className}
    />
  );
}
