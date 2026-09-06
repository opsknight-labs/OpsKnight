'use client';

import { ReactNode, ButtonHTMLAttributes } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

type MobileButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  href?: string;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90',
  secondary:
    'border border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-secondary)]',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
  ghost: 'bg-transparent text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-secondary)]',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-5 py-3 text-base rounded-2xl',
};

export default function MobileButton({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  icon,
  iconPosition = 'left',
  loading = false,
  href,
  className = '',
  disabled,
  ...props
}: MobileButtonProps) {
  const baseClasses = cn(
    'inline-flex items-center justify-center gap-2 font-semibold transition active:scale-[0.98]',
    disabled || loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    fullWidth && 'w-full',
    variantStyles[variant],
    sizeStyles[size],
    className
  );

  const content = (
    <>
      {loading ? (
        <span className="flex items-center">
          <LoadingSpinner />
        </span>
      ) : (
        <>
          {icon && iconPosition === 'left' && <span className="flex">{icon}</span>}
          <span>{children}</span>
          {icon && iconPosition === 'right' && <span className="flex">{icon}</span>}
        </>
      )}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={baseClasses}>
        {content}
      </Link>
    );
  }

  return (
    <button className={baseClasses} disabled={disabled || loading} {...props}>
      {content}
    </button>
  );
}

function LoadingSpinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="28"
        strokeDashoffset="8"
      />
    </svg>
  );
}

// Icon Button variant
export function MobileIconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  badge,
  ...props
}: {
  icon: ReactNode;
  badge?: number | string;
} & Omit<MobileButtonProps, 'children'>) {
  const iconSizes: Record<ButtonSize, string> = {
    sm: 'h-9 w-9',
    md: 'h-11 w-11',
    lg: 'h-12 w-12',
  };

  return (
    <div className="relative inline-flex">
      <MobileButton
        variant={variant}
        size={size}
        className={cn('rounded-full p-0', iconSizes[size])}
        {...props}
      >
        {icon}
      </MobileButton>
      {badge !== undefined && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[0.6rem] font-bold text-white">
          {badge}
        </span>
      )}
    </div>
  );
}
