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
      return 'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30 dark:hover:bg-emerald-500/15';
    case 'info':
      return 'bg-blue-50 text-blue-700 border-blue-200/80 hover:bg-blue-100/60 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30 dark:hover:bg-blue-500/15';
    case 'warning':
      return 'bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100/60 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/15';
    case 'danger':
      return 'bg-rose-50 text-rose-700 border-rose-200/80 hover:bg-rose-100/60 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30 dark:hover:bg-rose-500/15';
    case 'neutral':
    default:
      return 'bg-ink-100 text-ink-700 border-ink-200/80 hover:bg-ink-200/60';
  }
}

function AuditActionBadge({ action, className }: AuditActionBadgeProps) {
  const category = getActionCategory(action);
  const styleClass = getCategoryStyle(category);

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold font-mono tracking-tight border transition-colors',
        styleClass,
        className
      )}
    >
      {action}
    </span>
  );
}

export default memo(AuditActionBadge);
