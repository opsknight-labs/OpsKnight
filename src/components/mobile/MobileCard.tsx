'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { Card } from '@/components/ui/shadcn/card';
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
  lg: 'p-5 sm:p-6',
};

const variantStyles = {
  default: '',
  elevated: 'shadow-md',
  outlined: 'shadow-none',
  gradient: 'bg-gradient-to-br from-card to-muted/40',
};

export default function MobileCard({
  children,
  variant = 'default',
  padding = 'md',
  onClick,
  className,
}: MobileCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <Card
      className={cn(
        'min-w-0 rounded-2xl border-border bg-card text-card-foreground',
        onClick && 'cursor-pointer transition-transform active:scale-[0.99]',
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
    </Card>
  );
}

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
    <div className={cn('flex min-w-0 items-start justify-between gap-3', subtitle ? 'mb-2' : 'mb-3')}>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function MobileCardSection({
  children,
  noPadding = false,
}: {
  children: ReactNode;
  noPadding?: boolean;
}) {
  return <div className={cn('border-t border-border', noPadding ? 'p-0' : 'py-3')}>{children}</div>;
}
