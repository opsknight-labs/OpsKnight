'use client';

import { ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

type MobileCardProps = {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined' | 'gradient';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
};

const paddingSizes = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const variantStyles: Record<string, string> = {
  default:
    'mobile-card mobile-card--default bg-[color:var(--bg-surface)] border-[color:var(--border)]',
  elevated:
    'mobile-card mobile-card--elevated bg-[color:var(--bg-surface)] border-[color:var(--border)]',
  outlined: 'mobile-card mobile-card--outlined',
  gradient: 'mobile-card mobile-card--gradient',
};

export default function MobileCard({
  children,
  variant = 'default',
  padding = 'md',
  onClick,
  className = '',
}: MobileCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={cn(
        'transition active:scale-[0.99]',
        onClick ? 'cursor-pointer' : 'cursor-default',
        'rounded-2xl border',
        variantStyles[variant],
        paddingSizes[padding],
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}

// Card Header sub-component
export function MobileCardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn('flex items-start justify-between', subtitle ? 'mb-2' : 'mb-3')}>
      <div>
        <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-[color:var(--text-muted)]">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// Card Section sub-component
export function MobileCardSection({
  children,
  noPadding = false,
}: {
  children: ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className={cn('border-t border-[color:var(--border)]', noPadding ? 'p-0' : 'py-3')}>
      {children}
    </div>
  );
}
