'use client';

import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { legacyFieldSizeClass, legacyFieldStateClass, legacyIconInsetClass } from './Input';

type SelectSize = 'sm' | 'md' | 'lg';
type SelectVariant = 'default' | 'error' | 'success';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  size?: SelectSize;
  variant?: SelectVariant;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

function leftPaddingClass(size: SelectSize): string {
  return size === 'sm' ? 'pl-10' : size === 'lg' ? 'pl-14' : 'pl-12';
}

/**
 * Native `<select>` with the canonical shadcn field styling (same border, radius,
 * focus ring and disabled state as `@/components/ui/shadcn/select`'s trigger). It stays
 * native so existing `onChange(event)` callers keep working; use the shadcn Select for
 * new code.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    helperText,
    error,
    options,
    placeholder,
    size = 'md',
    variant = 'default',
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    id,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const hasError = !!error || variant === 'error';
  const state: SelectVariant = hasError ? 'error' : variant === 'success' ? 'success' : 'default';

  return (
    <div className={cn('ui-select-wrapper', fullWidth ? 'ui-select-full-width w-full' : 'w-auto')}>
      {label && (
        <label
          htmlFor={selectId}
          className="ui-select-label mb-2 block text-sm font-medium text-foreground"
        >
          {label}
          {props.required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className="ui-select-container relative flex items-center">
        {leftIcon && (
          <span
            className={cn(
              'ui-select-icon-left pointer-events-none absolute z-[1] flex items-center text-muted-foreground',
              legacyIconInsetClass(size, 'left')
            )}
          >
            {leftIcon}
          </span>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'ui-select flex w-full cursor-pointer appearance-none rounded-md border border-input bg-card text-foreground ring-offset-background transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            `ui-select-${size} ui-select-${variant}`,
            legacyFieldSizeClass(size),
            legacyFieldStateClass(state),
            leftIcon && leftPaddingClass(size),
            size === 'sm' ? 'pr-9' : 'pr-10',
            className
          )}
          aria-invalid={hasError}
          aria-describedby={
            error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined
          }
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map(option => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          className={cn(
            'ui-select-icon-right pointer-events-none absolute z-[1] flex items-center text-muted-foreground',
            rightIcon ? legacyIconInsetClass(size, 'right') : 'right-3'
          )}
        >
          {rightIcon ?? <ChevronDown className="h-4 w-4 opacity-70" aria-hidden="true" />}
        </span>
      </div>
      {error && (
        <p
          id={`${selectId}-error`}
          className="ui-select-error mt-2 flex items-center gap-1 text-sm text-destructive"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {helperText && !error && (
        <p
          id={`${selectId}-helper`}
          className="ui-select-helper mt-2 text-sm text-muted-foreground"
        >
          {helperText}
        </p>
      )}
    </div>
  );
});

export default Select;
