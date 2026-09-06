'use client';

import { useId } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  helperText?: string;
  error?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
  id?: string;
}

/**
 * Switch/Toggle component
 *
 * @example
 * <Switch
 *   checked={enabled}
 *   onChange={setEnabled}
 *   label="Enable notifications"
 * />
 */
export default function Switch({
  checked,
  onChange,
  label,
  helperText,
  error,
  disabled = false,
  size = 'md',
  fullWidth = false,
  className = '',
  id,
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id || generatedId;
  const hasError = !!error;

  const sizeStyles = {
    sm: {
      width: '36px',
      height: '20px',
      thumbSize: '16px',
      translate: '2px',
    },
    md: {
      width: '44px',
      height: '24px',
      thumbSize: '20px',
      translate: '2px',
    },
    lg: {
      width: '52px',
      height: '28px',
      thumbSize: '24px',
      translate: '2px',
    },
  };

  const styles = sizeStyles[size];

  return (
    <div
      className={`ui-switch-wrapper ${fullWidth ? 'ui-switch-full-width' : ''} ${className}`}
      style={{ width: fullWidth ? '100%' : 'auto' }}
    >
      <label
        htmlFor={switchId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-3)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          width: fullWidth ? '100%' : 'auto',
        }}
      >
        <div
          role="switch"
          aria-checked={checked}
          aria-labelledby={label ? `${switchId}-label` : undefined}
          style={{
            position: 'relative',
            width: styles.width,
            height: styles.height,
            borderRadius: 'var(--radius-full)',
            background: checked
              ? hasError
                ? 'var(--color-error)'
                : 'var(--primary-color)'
              : 'var(--color-neutral-300)',
            transition: 'all var(--transition-base) var(--ease-out)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
          onClick={() => !disabled && onChange(!checked)}
        >
          <div
            style={{
              position: 'absolute',
              top: styles.translate,
              left: checked
                ? `calc(100% - ${styles.thumbSize} - ${styles.translate})`
                : styles.translate,
              width: `calc(${styles.thumbSize} - ${styles.translate} * 2)`,
              height: `calc(${styles.thumbSize} - ${styles.translate} * 2)`,
              borderRadius: 'var(--radius-full)',
              background: 'white',
              boxShadow: 'var(--shadow-sm)',
              transition: 'all var(--transition-base) var(--ease-out)',
            }}
          />
        </div>
        {label && (
          <span
            id={`${switchId}-label`}
            style={{
              fontSize: 'var(--font-size-base)',
              color: 'var(--text-primary)',
              userSelect: 'none',
              flex: 1,
            }}
          >
            {label}
          </span>
        )}
      </label>
      {error && (
        <div
          id={`${switchId}-error`}
          className="ui-switch-error"
          style={{
            marginTop: 'var(--spacing-1)',
            marginLeft: `calc(${styles.width} + var(--spacing-3))`,
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
          id={`${switchId}-helper`}
          className="ui-switch-helper"
          style={{
            marginTop: 'var(--spacing-1)',
            marginLeft: `calc(${styles.width} + var(--spacing-3))`,
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
