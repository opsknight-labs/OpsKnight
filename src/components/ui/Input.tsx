'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Input as ShadcnInput } from './shadcn/input';
import { cn } from '@/lib/utils';

type InputSize = 'sm' | 'md' | 'lg';
type InputVariant = 'default' | 'error' | 'success';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  size?: InputSize;
  variant?: InputVariant;
  fullWidth?: boolean;
}

/** Field geometry shared by the legacy Input and Select wrappers (32 / 40 / 48px). */
export function legacyFieldSizeClass(size: InputSize): string {
  switch (size) {
    case 'sm':
      return 'h-8 px-3 text-sm md:text-sm';
    case 'lg':
      return 'h-12 px-5 text-lg md:text-lg';
    default:
      return 'h-10 px-4 text-base md:text-base';
  }
}

export function legacyIconInsetClass(size: InputSize, side: 'left' | 'right'): string {
  if (side === 'left') return size === 'sm' ? 'left-3' : size === 'lg' ? 'left-5' : 'left-4';
  return size === 'sm' ? 'right-3' : size === 'lg' ? 'right-5' : 'right-4';
}

function iconPaddingClass(size: InputSize, side: 'left' | 'right'): string {
  if (side === 'left') return size === 'sm' ? 'pl-10' : size === 'lg' ? 'pl-14' : 'pl-12';
  return size === 'sm' ? 'pr-10' : size === 'lg' ? 'pr-14' : 'pr-12';
}

/** Border/ring for the validation variants; shared with the legacy Select. */
export function legacyFieldStateClass(state: InputVariant): string {
  switch (state) {
    case 'error':
      return 'border-destructive hover:border-destructive focus-visible:ring-destructive';
    case 'success':
      return 'border-status-ok hover:border-status-ok focus-visible:ring-status-ok';
    default:
      return 'hover:border-ink-300';
  }
}

/**
 * Compatibility wrapper over the canonical shadcn `Input`
 * (`@/components/ui/shadcn/input`) that adds label, helper/error text and icons.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    leftIcon,
    rightIcon,
    size = 'md',
    variant = 'default',
    fullWidth = false,
    className,
    id,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hasError = !!error || variant === 'error';
  const state: InputVariant = hasError ? 'error' : variant === 'success' ? 'success' : 'default';
  const describedBy = error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined;

  return (
    <div className={cn('ui-input-wrapper', fullWidth ? 'ui-input-full-width w-full' : 'w-auto')}>
      {label && (
        <label
          htmlFor={inputId}
          className="ui-input-label mb-2 block text-sm font-medium text-foreground"
        >
          {label}
          {props.required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="ui-input-container relative flex items-center">
        {leftIcon && (
          <span
            className={cn(
              'ui-input-icon-left absolute z-[1] flex items-center text-muted-foreground',
              legacyIconInsetClass(size, 'left')
            )}
          >
            {leftIcon}
          </span>
        )}
        <ShadcnInput
          ref={ref}
          id={inputId}
          className={cn(
            'ui-input bg-card transition-colors duration-150',
            `ui-input-${size} ui-input-${variant}`,
            legacyFieldSizeClass(size),
            legacyFieldStateClass(state),
            leftIcon && iconPaddingClass(size, 'left'),
            rightIcon && iconPaddingClass(size, 'right'),
            className
          )}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          {...props}
        />
        {rightIcon && (
          <span
            className={cn(
              'ui-input-icon-right absolute z-[1] flex items-center text-muted-foreground',
              legacyIconInsetClass(size, 'right')
            )}
          >
            {rightIcon}
          </span>
        )}
      </div>
      {error && (
        <p
          id={`${inputId}-error`}
          className="ui-input-error mt-2 flex items-center gap-1 text-sm text-destructive"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {helperText && !error && (
        <p id={`${inputId}-helper`} className="ui-input-helper mt-2 text-sm text-muted-foreground">
          {helperText}
        </p>
      )}
    </div>
  );
});

export default Input;
