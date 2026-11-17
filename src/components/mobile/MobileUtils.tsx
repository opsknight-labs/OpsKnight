'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';
import EmptyState from '@/components/patterns/EmptyState';

/** @deprecated Use `StatusBadge` from `@/components/patterns`. Kept as a thin alias. */
export function MobileStatusBadge({
  status,
  size = 'md',
}: {
  status: 'open' | 'acknowledged' | 'resolved' | 'snoozed' | 'suppressed';
  size?: 'sm' | 'md';
}) {
  return <StatusBadge status={status.toUpperCase()} size={size === 'sm' ? 'xs' : 'sm'} />;
}

/** @deprecated Use `SeverityBadge` from `@/components/patterns`. Kept as a thin alias. */
export function MobileUrgencyBadge({
  urgency,
  size = 'md',
}: {
  urgency: 'high' | 'medium' | 'low';
  size?: 'sm' | 'md';
}) {
  return <SeverityBadge urgency={urgency.toUpperCase()} size={size === 'sm' ? 'xs' : 'sm'} />;
}

// Avatar component
export function MobileAvatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const [hasError, setHasError] = useState(false);
  const sizeClass = (() => {
    switch (size) {
      case 'sm':
        return 'h-7 w-7 text-2xs';
      case 'md':
        return 'h-9 w-9 text-xs';
      case 'lg':
        return 'h-12 w-12 text-base';
      case 'xl':
        return 'h-16 w-16 text-lg';
    }
  })();
  const imageSize = (() => {
    switch (size) {
      case 'sm':
        return 28;
      case 'md':
        return 36;
      case 'lg':
        return 48;
      case 'xl':
        return 64;
    }
  })();
  const initials =
    (name || 'U')
      .trim()
      .split(/\s+/)
      .map(n => n[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';

  if (src && !hasError) {
    return (
      <Image
        src={src}
        alt={name || 'User'}
        width={imageSize}
        height={imageSize}
        className={cn('shrink-0 rounded-full object-cover', sizeClass)}
        onError={() => setHasError(true)}
        unoptimized
      />
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground',
        sizeClass
      )}
    >
      {initials}
    </div>
  );
}

// Health Indicator
export function MobileHealthIndicator({
  status,
  size = 'md',
  pulse = true,
}: {
  status: 'healthy' | 'degraded' | 'critical';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}) {
  const colorClass = (() => {
    switch (status) {
      case 'healthy':
        return 'bg-emerald-500';
      case 'degraded':
        return 'bg-amber-500';
      case 'critical':
        return 'bg-red-500';
    }
  })();
  const indicatorSize = (() => {
    switch (size) {
      case 'sm':
        return 'h-2 w-2';
      case 'md':
        return 'h-2.5 w-2.5';
      case 'lg':
        return 'h-3 w-3';
    }
  })();

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        indicatorSize,
        colorClass,
        pulse && status !== 'healthy' && 'animate-pulse'
      )}
    />
  );
}

// Progress Bar
export function MobileProgressBar({
  value,
  max = 100,
  variant = 'primary',
  showLabel = false,
  height = '6px',
}: {
  value: number;
  max?: number;
  variant?: 'primary' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
  height?: string;
}) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const barColor = (() => {
    switch (variant) {
      case 'primary':
        return 'bg-primary';
      case 'success':
        return 'bg-emerald-500';
      case 'warning':
        return 'bg-amber-500';
      case 'danger':
        return 'bg-red-500';
    }
  })();

  return (
    <div>
      <div className="w-full overflow-hidden rounded-full bg-muted" style={{ height }}>
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-right text-xs font-medium tabular-nums text-muted-foreground">
          {Math.round(percentage)}%
        </div>
      )}
    </div>
  );
}

/** @deprecated Use `EmptyState` from `@/components/patterns`. Kept as a thin alias. */
export function MobileEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} description={description} action={action} size="sm" />
  );
}
