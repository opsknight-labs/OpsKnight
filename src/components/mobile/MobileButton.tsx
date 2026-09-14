'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
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

function getVariantConfig(variant: ButtonVariant) {
  switch (variant) {
    case 'secondary':
      return { variant: 'outline' as const, className: '' };
    case 'danger':
      return { variant: 'destructive' as const, className: '' };
    case 'success':
      return {
        variant: 'default' as const,
        className:
          'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500',
      };
    case 'warning':
      return {
        variant: 'default' as const,
        className:
          'bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400',
      };
    case 'ghost':
      return { variant: 'ghost' as const, className: '' };
    case 'primary':
    default:
      return { variant: 'default' as const, className: '' };
  }
}

function getSizeConfig(size: ButtonSize) {
  switch (size) {
    case 'sm':
      return { size: 'sm' as const, className: 'min-h-10 rounded-lg' };
    case 'lg':
      return { size: 'lg' as const, className: 'min-h-12 rounded-xl' };
    case 'md':
    default:
      return { size: 'default' as const, className: 'min-h-11 rounded-xl' };
  }
}

function getIconSize(size: ButtonSize) {
  switch (size) {
    case 'sm':
      return 'h-10 w-10';
    case 'lg':
      return 'h-12 w-12';
    case 'md':
    default:
      return 'h-11 w-11';
  }
}

export default function MobileButton({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  icon,
  iconPosition = 'left',
  loading = false,
  href,
  className,
  disabled,
  ...props
}: MobileButtonProps) {
  const variantStyle = getVariantConfig(variant);
  const sizeStyle = getSizeConfig(size);
  const classes = cn(
    'font-semibold active:scale-[0.98]',
    variantStyle.className,
    sizeStyle.className,
    fullWidth && 'w-full',
    className
  );

  const content = (
    <>
      {loading ? (
        <LoadingSpinner />
      ) : icon && iconPosition === 'left' ? (
        <span className="flex">{icon}</span>
      ) : null}
      <span>{children}</span>
      {!loading && icon && iconPosition === 'right' ? <span className="flex">{icon}</span> : null}
    </>
  );

  if (href && !disabled && !loading) {
    return (
      <Button asChild variant={variantStyle.variant} size={sizeStyle.size} className={classes}>
        <Link href={href}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button
      variant={variantStyle.variant}
      size={sizeStyle.size}
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {content}
    </Button>
  );
}

function LoadingSpinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
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
  return (
    <div className="relative inline-flex">
      <MobileButton
        variant={variant}
        size={size}
        className={cn('rounded-full p-0', getIconSize(size))}
        {...props}
      >
        {icon}
      </MobileButton>
      {badge !== undefined && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[0.6rem] font-bold text-destructive-foreground">
          {badge}
        </span>
      )}
    </div>
  );
}
