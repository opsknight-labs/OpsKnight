'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Status Badge component
export function MobileStatusBadge({
  status,
  size = 'md',
}: {
  status: 'open' | 'acknowledged' | 'resolved' | 'snoozed' | 'suppressed';
  size?: 'sm' | 'md';
}) {
  const statusConfig = (() => {
    switch (status) {
      case 'open':
        return {
          label: 'Open',
          classes: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
        };
      case 'acknowledged':
        return {
          label: 'Acknowledged',
          classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
        };
      case 'resolved':
        return {
          label: 'Resolved',
          classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
        };
      case 'snoozed':
        return {
          label: 'Snoozed',
          classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
        };
      case 'suppressed':
        return {
          label: 'Suppressed',
          classes: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
        };
    }
  })();

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-bold uppercase tracking-wide',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
        statusConfig.classes
      )}
    >
      {statusConfig.label}
    </span>
  );
}

// Urgency Badge component
export function MobileUrgencyBadge({
  urgency,
  size = 'md',
}: {
  urgency: 'high' | 'medium' | 'low';
  size?: 'sm' | 'md';
}) {
  const urgencyConfig = (() => {
    switch (urgency) {
      case 'high':
        return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
      case 'medium':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
      case 'low':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
    }
  })();

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-bold uppercase tracking-wide',
        size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
        urgencyConfig
      )}
    >
      {urgency}
    </span>
  );
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
        return 'h-7 w-7 text-[11px]';
      case 'md':
        return 'h-9 w-9 text-[13px]';
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
        className={cn('rounded-full object-cover', sizeClass)}
        onError={() => setHasError(true)}
        unoptimized
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full font-bold text-white',
        sizeClass,
        'bg-gradient-to-br from-slate-200 to-slate-50 dark:from-slate-700 dark:to-slate-900 text-[color:var(--text-primary)]'
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
      <div
        className="w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        style={{ height }}
      >
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-right text-[11px] font-medium text-[color:var(--text-muted)]">
          {Math.round(percentage)}%
        </div>
      )}
    </div>
  );
}

// Empty State component
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-4 py-10 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--bg-secondary)] text-2xl text-[color:var(--text-muted)]">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{title}</h3>
      {description && <p className="text-xs text-[color:var(--text-muted)]">{description}</p>}
      {action && <div className="mt-2 flex flex-col gap-2">{action}</div>}
    </div>
  );
}

export function MobileEmptyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path
        d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9.5 12.5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Skeleton Loader
export function MobileSkeleton({
  width = '100%',
  height = '1rem',
  variant = 'text',
  className = '',
}: {
  width?: string;
  height?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  className?: string;
}) {
  const borderRadius = (() => {
    switch (variant) {
      case 'text':
        return '4px';
      case 'circular':
        return '50%';
      case 'rectangular':
        return '8px';
    }
  })();

  return (
    <div
      className={cn('animate-[shimmer_1.5s_infinite]', className)}
      style={{
        width: variant === 'circular' ? height : width,
        height,
        borderRadius,
        background:
          'linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-surface) 50%, var(--bg-secondary) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
      }}
    />
  );
}

// Divider
export function MobileDivider({
  label,
  spacing = 'md',
}: {
  label?: string;
  spacing?: 'sm' | 'md' | 'lg';
}) {
  const spacingValue = (() => {
    switch (spacing) {
      case 'sm':
        return '0.5rem';
      case 'md':
        return '1rem';
      case 'lg':
        return '1.5rem';
    }
  })();

  if (label) {
    return (
      <div className="flex items-center gap-3" style={{ margin: `${spacingValue} 0` }}>
        <div className="h-px flex-1 bg-[color:var(--border)]" />
        <span className="text-[11px] font-semibold text-[color:var(--text-muted)]">{label}</span>
        <div className="h-px flex-1 bg-[color:var(--border)]" />
      </div>
    );
  }

  return <div className="h-px bg-[color:var(--border)]" style={{ margin: `${spacingValue} 0` }} />;
}
