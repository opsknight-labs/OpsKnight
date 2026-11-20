import { memo } from 'react';
import { cn } from '@/lib/utils';

export type AuditActionBadgeProps = {
  action: string;
  className?: string;
};

export type ActionCategory = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function getActionCategory(action: string): ActionCategory {
  const upper = action.toUpperCase();

  if (
    upper.includes('CREATE') ||
    upper.includes('INVITE') ||
    upper.includes('ENABLE') ||
    upper.includes('SUCCESS') ||
    upper.includes('RESOLVE') ||
    upper.includes('ACTIVATE')
  ) {
    return 'success';
  }

  if (
    upper.includes('DELETE') ||
    upper.includes('REMOVE') ||
    upper.includes('REVOKE') ||
    upper.includes('FAIL') ||
    upper.includes('SUSPEND') ||
    upper.includes('DISABLE')
  ) {
    return 'danger';
  }

  if (
    upper.includes('UPDATE') ||
    upper.includes('EDIT') ||
    upper.includes('ASSIGN') ||
    upper.includes('TRANSFER') ||
    upper.includes('CHANGE')
  ) {
    return 'info';
  }

  if (
    upper.includes('WARNING') ||
    upper.includes('TRIGGER') ||
    upper.includes('BREACH') ||
    upper.includes('ALERT')
  ) {
    return 'warning';
  }

  return 'neutral';
}

function getCategoryStyle(category: ActionCategory): string {
  switch (category) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30';
    case 'info':
      return 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30';
    case 'warning':
      return 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30';
    case 'danger':
      return 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30';
    case 'neutral':
    default:
      return 'bg-ink-100 text-ink-700 border-ink-200/80';
  }
}

function AuditActionBadge({ action, className }: AuditActionBadgeProps) {
  const category = getActionCategory(action);
  const styleClass = getCategoryStyle(category);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tracking-tight',
        styleClass,
        className
      )}
    >
      {action}
    </span>
  );
}

export default memo(AuditActionBadge);
