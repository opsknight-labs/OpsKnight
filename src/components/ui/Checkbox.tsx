'use client';

import { InputHTMLAttributes, useId } from 'react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

/**
 * Checkbox component
 *
 * @example
 * <Checkbox
 *   label="Accept terms"
 *   checked={checked}
 *   onChange={(e) => setChecked(e.target.checked)}
 * />
 */
export default function Checkbox({
  label,
  helperText,
  error,
  size = 'md',
  fullWidth = false,
  className = '',
  id,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const checkboxId = id || generatedId;
  const hasError = !!error;

  const sizeStyles = {
    sm: { width: '16px', height: '16px' },
    md: { width: '20px', height: '20px' },
    lg: { width: '24px', height: '24px' },
  };

  return (
    <div
      className={`ui-checkbox-wrapper ${fullWidth ? 'ui-checkbox-full-width' : ''}`}
      style={{ width: fullWidth ? '100%' : 'auto' }}
    >
      <label
        htmlFor={checkboxId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          cursor: props.disabled ? 'not-allowed' : 'pointer',
          opacity: props.disabled ? 0.6 : 1,
          width: fullWidth ? '100%' : 'auto',
        }}
      >
        <input
          type="checkbox"
          id={checkboxId}
          className={`ui-checkbox ui-checkbox-${size} ${className}`}
          style={{
            ...sizeStyles[size],
            cursor: props.disabled ? 'not-allowed' : 'pointer',
            accentColor: hasError ? 'var(--color-error)' : 'var(--primary-color)',
          }}
          aria-invalid={hasError}
          aria-describedby={
            error ? `${checkboxId}-error` : helperText ? `${checkboxId}-helper` : undefined
          }
          {...props}
        />
        {label && (
          <span
            style={{
              fontSize: 'var(--font-size-base)',
              color: 'var(--text-primary)',
              userSelect: 'none',
            }}
          >
            {label}
            {props.required && (
              <span style={{ color: 'var(--color-error)', marginLeft: 'var(--spacing-1)' }}>*</span>
            )}
          </span>
        )}
      </label>
      {error && (
        <div
          id={`${checkboxId}-error`}
          className="ui-checkbox-error"
          style={{
            marginTop: 'var(--spacing-1)',
            marginLeft: `calc(${sizeStyles[size].width} + var(--spacing-2))`,
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
          id={`${checkboxId}-helper`}
          className="ui-checkbox-helper"
          style={{
            marginTop: 'var(--spacing-1)',
            marginLeft: `calc(${sizeStyles[size].width} + var(--spacing-2))`,
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
