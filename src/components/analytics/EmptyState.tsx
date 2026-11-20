import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import PatternEmptyState from '@/components/patterns/EmptyState';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  image?: ReactNode;
  className?: string;
}

/** Analytics empty state; delegates to `@/components/patterns/EmptyState`. */
export default function EmptyState({
  title,
  description,
  icon,
  action,
  image,
  className,
}: EmptyStateProps) {
  return (
    <PatternEmptyState
      icon={image ?? icon}
      title={title}
      description={description}
      action={action}
      variant="simple"
      size="lg"
      className={cn('analytics-empty-state min-h-[300px]', className)}
    />
  );
}
