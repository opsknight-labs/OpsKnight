'use client';

import { InputHTMLAttributes, ReactNode, useId } from 'react';

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

export default function Input({
  label,
  helperText,
  error,
  leftIcon,
  rightIcon,
  size = 'md',
  variant = 'default',
  fullWidth = false,
  className = '',
  id,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hasError = !!error || variant === 'error';
  const hasSuccess = variant === 'success';

  const sizeStyles = {
    sm: {
      padding: '0.5rem 0.75rem',
      fontSize: 'var(--font-size-sm)',
      height: '32px',
    },
    md: {
      padding: '0.75rem 1rem',
      fontSize: 'var(--font-size-base)',
      height: '40px',
    },
    lg: {
      padding: '1rem 1.25rem',
      fontSize: 'var(--font-size-lg)',
      height: '48px',
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
    <div className={`ui-input-wrapper ${fullWidth ? 'ui-input-full-width' : ''}`} style={{ width: fullWidth ? '100%' : 'auto' }}>
      {label && (
        <label
          htmlFor={inputId}
          className="ui-input-label"
          style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 500,
            color: 'var(--text-primary)',
          }}
        >
          {label}
          {props.required && <span style={{ color: 'var(--color-error)', marginLeft: '0.25rem' }}>*</span>}
        </label>
      )}
      <div
        className="ui-input-container"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {leftIcon && (
          <span
            className="ui-input-icon-left"
            style={{
              position: 'absolute',
              left: size === 'sm' ? '0.75rem' : size === 'md' ? '1rem' : '1.25rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              zIndex: 1,
            }}
          >
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          className={`ui-input ui-input-${size} ui-input-${variant} ${className}`}
          style={{
            ...sizeStyles[size],
            width: '100%',
            border: `1px solid ${variantStyles[hasError ? 'error' : hasSuccess ? 'success' : 'default'].borderColor}`,
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontFamily: 'inherit',
            transition: 'all var(--transition-base) var(--ease-out)',
            paddingLeft: leftIcon ? (size === 'sm' ? '2.5rem' : size === 'md' ? '3rem' : '3.5rem') : undefined,
            paddingRight: rightIcon ? (size === 'sm' ? '2.5rem' : size === 'md' ? '3rem' : '3.5rem') : undefined,
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
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...props}
        />
        {rightIcon && (
          <span
            className="ui-input-icon-right"
            style={{
              position: 'absolute',
              right: size === 'sm' ? '0.75rem' : size === 'md' ? '1rem' : '1.25rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              zIndex: 1,
            }}
          >
            {rightIcon}
          </span>
        )}
      </div>
      {error && (
        <div
          id={`${inputId}-error`}
          className="ui-input-error"
          style={{
            marginTop: '0.5rem',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-error)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}
        >
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}
      {helperText && !error && (
        <div
          id={`${inputId}-helper`}
          className="ui-input-helper"
          style={{
            marginTop: '0.5rem',
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


