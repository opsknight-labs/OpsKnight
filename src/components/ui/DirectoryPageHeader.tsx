import React, { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/patterns/PageHeader';

export type DirectoryPageHeaderProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  className?: string;
};

/** @deprecated Use `PageHeader` (+ `FilterBar`) from `@/components/patterns`. */
export default function DirectoryPageHeader({
  title,
  description,
  badge,
  actions,
  filters,
  className,
}: DirectoryPageHeaderProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <PageHeader title={title} description={description} badges={badge} primaryAction={actions} />
      {filters && <div>{filters}</div>}
    </div>
  );
}
