'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import Spinner from './Spinner';

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

/**
 * Button component with variants, sizes, and loading states
 *
 * @example
 * <Button variant="primary" size="md" isLoading={false}>
 *   Click Me
 * </Button>
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || isLoading;

  const baseStyles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--spacing-2)',
    fontFamily: 'inherit',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    transition: 'all var(--transition-base) var(--ease-out)',
    textDecoration: 'none',
    width: fullWidth ? '100%' : 'auto',
    opacity: isDisabled ? 0.6 : 1,
    position: 'relative',
  };

  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: {
      padding: 'var(--spacing-2) var(--spacing-4)',
      fontSize: 'var(--font-size-sm)',
      height: '32px',
    },
    md: {
      padding: 'var(--spacing-3) var(--spacing-6)',
      fontSize: 'var(--font-size-base)',
      height: '40px',
    },
    lg: {
      padding: 'var(--spacing-4) var(--spacing-8)',
      fontSize: 'var(--font-size-lg)',
      height: '48px',
    },
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--primary-color)',
      color: 'var(--text-inverse)',
      boxShadow: 'var(--shadow-sm)',
    },
    secondary: {
      background: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-xs)',
    },
    danger: {
      background: 'var(--color-error)',
      color: 'var(--text-inverse)',
      boxShadow: 'var(--shadow-sm)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-primary)',
    },
    link: {
      background: 'transparent',
      color: 'var(--primary-color)',
      padding: 0,
      height: 'auto',
      textDecoration: 'underline',
    },
  };

  const hoverStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--primary-hover)',
      boxShadow: 'var(--shadow-md)',
    },
    secondary: {
      background: 'var(--color-neutral-50)',
      borderColor: 'var(--border-hover)',
    },
    danger: {
      background: 'var(--color-error-dark)',
      boxShadow: 'var(--shadow-md)',
    },
    ghost: {
      background: 'var(--color-neutral-100)',
    },
    link: {
      color: 'var(--primary-hover)',
    },
  };

  const combinedStyles: React.CSSProperties = {
    ...baseStyles,
    ...sizeStyles[size],
    ...variantStyles[variant],
  };

  return (
    <button
      className={`ui-button ui-button-${variant} ui-button-${size} ${className}`}
      style={combinedStyles}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={isLoading}
      onMouseEnter={e => {
        if (!isDisabled) {
          Object.assign(e.currentTarget.style, hoverStyles[variant]);
        }
      }}
      onMouseLeave={e => {
        if (!isDisabled) {
          Object.assign(e.currentTarget.style, variantStyles[variant]);
        }
      }}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner
            size={size === 'sm' ? 'sm' : 'md'}
            variant={variant === 'primary' || variant === 'danger' ? 'white' : 'default'}
          />
          <span style={{ opacity: 0 }}>{children}</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="ui-button-icon-left">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="ui-button-icon-right">{rightIcon}</span>}
        </>
      )}
    </button>
  );
}
