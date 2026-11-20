'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Button as ShadcnButton, type ButtonProps as ShadcnButtonProps } from './shadcn/button';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

function shadcnVariant(variant: ButtonVariant): ShadcnButtonProps['variant'] {
  switch (variant) {
    case 'secondary':
      return 'outline';
    case 'danger':
      return 'destructive';
    case 'ghost':
      return 'ghost';
    case 'link':
      return 'link';
    default:
      return 'default';
  }
}

// The legacy scale: 32 / 40 / 48px tall, semibold, roomier padding than shadcn.
function sizeClass(size: ButtonSize, variant: ButtonVariant): string {
  if (variant === 'link') return 'h-auto p-0';
  switch (size) {
    case 'sm':
      return 'h-8 px-4 text-sm';
    case 'lg':
      return 'h-12 px-8 text-lg';
    default:
      return 'h-10 px-6 text-base';
  }
}

function variantClass(variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
    case 'danger':
      return 'shadow-sm hover:shadow-md';
    case 'secondary':
      return 'bg-card shadow-xs hover:border-ink-300 hover:bg-muted';
    case 'link':
      return 'underline';
    default:
      return '';
  }
}

/**
 * Compatibility wrapper over the canonical shadcn `Button`
 * (`@/components/ui/shadcn/button`). New code should use the shadcn button directly.
 *
 * @example
 * <Button variant="primary" size="md" isLoading={false}>Click Me</Button>
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <ShadcnButton
      ref={ref}
      variant={shadcnVariant(variant)}
      loading={isLoading}
      disabled={disabled}
      aria-disabled={disabled || isLoading}
      className={cn(
        'ui-button font-semibold transition-[color,background-color,border-color,box-shadow] duration-150',
        `ui-button-${variant} ui-button-${size}`,
        sizeClass(size, variant),
        variantClass(variant),
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {leftIcon && (
        <span className="ui-button-icon-left inline-flex shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {children}
      {rightIcon && (
        <span className="ui-button-icon-right inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </ShadcnButton>
  );
});

export default Button;
