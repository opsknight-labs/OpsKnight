'use client';

import { SelectHTMLAttributes, ReactNode, useId } from 'react';

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

/**
 * Select component for dropdowns
 * 
 * @example
 * <Select
 *   label="Choose option"
 *   options={[
 *     { value: '1', label: 'Option 1' },
 *     { value: '2', label: 'Option 2' }
 *   ]}
 *   error={errors.option}
 * />
 */
export default function Select({
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
  className = '',
  id,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const hasError = !!error || variant === 'error';
  const hasSuccess = variant === 'success';

  const sizeStyles = {
    sm: {
      padding: '0.5rem 0.75rem',
      paddingLeft: leftIcon ? '2.5rem' : undefined,
      paddingRight: rightIcon ? '2.5rem' : undefined,
      fontSize: 'var(--font-size-sm)',
      height: '32px',
      lineHeight: '1.5',
    },
    md: {
      padding: '0.75rem 1rem',
      paddingLeft: leftIcon ? '3rem' : undefined,
      paddingRight: rightIcon ? '3rem' : undefined,
      fontSize: 'var(--font-size-base)',
      height: '40px',
      lineHeight: '1.5',
    },
    lg: {
      padding: '1rem 1.25rem',
      paddingLeft: leftIcon ? '3.5rem' : undefined,
      paddingRight: rightIcon ? '3.5rem' : undefined,
      fontSize: 'var(--font-size-lg)',
      height: '48px',
      lineHeight: '1.5',
    },
  };

  const variantStyles = {
    default: {
      borderColor: 'var(--border)',
    },
    error: {
      borderColor: 'var(--color-error)',
    },
    success: {
      borderColor: 'var(--color-success)',
    },
  };

  return (
    <div className={`ui-select-wrapper ${fullWidth ? 'ui-select-full-width' : ''}`} style={{ width: fullWidth ? '100%' : 'auto' }}>
      {label && (
        <label
          htmlFor={selectId}
          className="ui-select-label"
          style={{
            display: 'block',
            marginBottom: 'var(--spacing-2)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--text-primary)',
          }}
        >
          {label}
          {props.required && <span style={{ color: 'var(--color-error)', marginLeft: 'var(--spacing-1)' }}>*</span>}
        </label>
      )}
      <div
        className="ui-select-container"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {leftIcon && (
          <span
            className="ui-select-icon-left"
            style={{
              position: 'absolute',
              left: size === 'sm' ? '0.75rem' : size === 'md' ? '1rem' : '1.25rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          >
            {leftIcon}
          </span>
        )}
        <select
          id={selectId}
          className={`ui-select ui-select-${size} ui-select-${variant} ${className}`}
          style={{
            ...sizeStyles[size],
            width: '100%',
            border: `1px solid ${variantStyles[hasError ? 'error' : hasSuccess ? 'success' : 'default'].borderColor}`,
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            transition: 'all var(--transition-base) var(--ease-out)',
            appearance: 'none',
            backgroundImage: rightIcon ? 'none' : `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2 4L6 8L10 4' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 0.75rem center',
            paddingRight: rightIcon ? undefined : '2.5rem',
            cursor: 'pointer',
            lineHeight: sizeStyles[size].lineHeight,
            boxSizing: 'border-box',
            verticalAlign: 'middle',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = hasError ? 'var(--color-error)' : hasSuccess ? 'var(--color-success)' : 'var(--border-focus)';
            e.currentTarget.style.boxShadow = `0 0 0 3px ${hasError ? 'rgba(239, 68, 68, 0.1)' : hasSuccess ? 'rgba(34, 197, 94, 0.1)' : 'rgba(211, 47, 47, 0.1)'}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = variantStyles[hasError ? 'error' : hasSuccess ? 'success' : 'default'].borderColor as string;
            e.currentTarget.style.boxShadow = 'none';
          }}
          aria-invalid={hasError}
          aria-describedby={error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {rightIcon && (
          <span
            className="ui-select-icon-right"
            style={{
              position: 'absolute',
              right: size === 'sm' ? '0.75rem' : size === 'md' ? '1rem' : '1.25rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          >
            {rightIcon}
          </span>
        )}
      </div>
      {error && (
        <div
          id={`${selectId}-error`}
          className="ui-select-error"
          style={{
            marginTop: 'var(--spacing-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-error)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-1)',
          }}
        >
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}
      {helperText && !error && (
        <div
          id={`${selectId}-helper`}
          className="ui-select-helper"
          style={{
            marginTop: 'var(--spacing-2)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-muted)',
          }}
        >
          {helperText}
        </div>
      )}
    </div>
  );
}
