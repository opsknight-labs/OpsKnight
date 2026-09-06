'use client';

import { ReactNode, memo, useMemo } from 'react';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'danger' | 'info';
type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Badge component for labels and status indicators
 *
 * @example
 * <Badge variant="success" size="md" dot>Active</Badge>
 */
function Badge({
  variant = 'default',
  size = 'md',
  dot = false,
  children,
  className = '',
  style: customStyle = {},
}: BadgeProps) {
  // Memoize styles to prevent recreation on every render
  const baseStyles: React.CSSProperties = useMemo(
    () => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--spacing-1)',
      borderRadius: 'var(--radius-full)',
      fontWeight: 'var(--font-weight-medium)',
      whiteSpace: 'nowrap',
    }),
    []
  );

  const sizeStyles: Record<BadgeSize, React.CSSProperties> = useMemo(
    () => ({
      xs: {
        padding: '2px 6px',
        fontSize: '10px',
        height: '16px',
      },
      sm: {
        padding: 'var(--spacing-1) var(--spacing-2)',
        fontSize: 'var(--font-size-xs)',
        height: '18px',
      },
      md: {
        padding: 'var(--spacing-1) var(--spacing-3)',
        fontSize: 'var(--font-size-sm)',
        height: '22px',
      },
      lg: {
        padding: 'var(--spacing-2) var(--spacing-4)',
        fontSize: 'var(--font-size-base)',
        height: '26px',
      },
    }),
    []
  );

  const variantStyles: Record<BadgeVariant, React.CSSProperties> = useMemo(
    () => ({
      default: {
        background: 'var(--badge-neutral-bg)',
        color: 'var(--badge-neutral-text)',
      },
      primary: {
        background: 'var(--primary-color)',
        color: 'var(--text-inverse)',
      },
      success: {
        background: 'var(--badge-success-bg)',
        color: 'var(--badge-success-text)',
      },
      warning: {
        background: 'var(--badge-warning-bg)',
        color: 'var(--badge-warning-text)',
      },
      error: {
        background: 'var(--badge-error-bg)',
        color: 'var(--badge-error-text)',
      },
      danger: {
        background: 'var(--badge-error-bg)',
        color: 'var(--badge-error-text)',
      },
      info: {
        background: 'var(--badge-info-bg)',
        color: 'var(--badge-info-text)',
      },
    }),
    []
  );

  const dotStyles: React.CSSProperties = useMemo(
    () => ({
      width: '6px',
      height: '6px',
      borderRadius: 'var(--radius-full)',
      background: 'currentColor',
    }),
    []
  );

  return (
    <span
      data-badge="true"
      className={`ui-badge ui-badge-${variant} ui-badge-${size} ${className}`}
      style={{
        ...baseStyles,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...customStyle,
      }}
    >
      {dot && <span style={dotStyles} />}
      {children}
    </span>
  );
}

// Memoize Badge to prevent unnecessary re-renders (frequently used component)
export default memo(Badge);
