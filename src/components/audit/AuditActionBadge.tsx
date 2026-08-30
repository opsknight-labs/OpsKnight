import { memo } from 'react';
import { cn } from '@/lib/utils';

export type AuditActionBadgeProps = {
  action: string;
  className?: string;
};

export function getActionCategory(
  action: string
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
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

const CATEGORY_STYLES: Record<ReturnType<typeof getActionCategory>, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/60',
  info: 'bg-blue-50 text-blue-700 border-blue-200/80 hover:bg-blue-100/60',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/80 hover:bg-amber-100/60',
  danger: 'bg-rose-50 text-rose-700 border-rose-200/80 hover:bg-rose-100/60',
  neutral: 'bg-slate-100 text-slate-700 border-slate-200/80 hover:bg-slate-200/60',
};

function AuditActionBadge({ action, className }: AuditActionBadgeProps) {
  const category = getActionCategory(action);
  const styleClass = CATEGORY_STYLES[category];

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
