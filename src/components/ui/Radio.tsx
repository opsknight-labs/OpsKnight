'use client';

import { InputHTMLAttributes, ReactNode, useId } from 'react';

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

/**
 * Radio button component
 *
 * @example
 * <Radio
 *   name="option"
 *   value="1"
 *   label="Option 1"
 *   checked={selected === '1'}
 *   onChange={(e) => setSelected(e.target.value)}
 * />
 */
export default function Radio({
  label,
  helperText,
  error,
  size = 'md',
  fullWidth = false,
  className = '',
  id,
  ...props
}: RadioProps) {
  const generatedId = useId();
  const radioId = id || generatedId;
  const hasError = !!error;

  const sizeStyles = {
    sm: { width: '16px', height: '16px' },
    md: { width: '20px', height: '20px' },
    lg: { width: '24px', height: '24px' },
  };

  return (
    <div
      className={`ui-radio-wrapper ${fullWidth ? 'ui-radio-full-width' : ''}`}
      style={{ width: fullWidth ? '100%' : 'auto' }}
    >
      <label
        htmlFor={radioId}
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
          type="radio"
          id={radioId}
          className={`ui-radio ui-radio-${size} ${className}`}
          style={{
            ...sizeStyles[size],
            cursor: props.disabled ? 'not-allowed' : 'pointer',
            accentColor: hasError ? 'var(--color-error)' : 'var(--primary-color)',
          }}
          aria-invalid={hasError}
          aria-describedby={
            error ? `${radioId}-error` : helperText ? `${radioId}-helper` : undefined
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
          id={`${radioId}-error`}
          className="ui-radio-error"
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
          id={`${radioId}-helper`}
          className="ui-radio-helper"
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

/**
 * RadioGroup component for grouping radio buttons
 */
export function RadioGroup({
  label,
  error,
  helperText,
  children,
  className = '',
}: {
  label?: string;
  error?: string;
  helperText?: string;
  children: ReactNode;
  className?: string;
}) {
  const groupId = useId();

  return (
    <div
      className={`ui-radio-group ${className}`}
      role="radiogroup"
      aria-labelledby={label ? `${groupId}-label` : undefined}
    >
      {label && (
        <div
          id={`${groupId}-label`}
          style={{
            marginBottom: 'var(--spacing-2)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
        {children}
      </div>
      {error && (
        <div
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
