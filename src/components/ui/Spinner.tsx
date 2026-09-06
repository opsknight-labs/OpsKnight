'use client';

import { CSSProperties } from 'react';

type SpinnerSize = 'sm' | 'md' | 'lg';
type SpinnerVariant = 'default' | 'primary' | 'white' | 'black';

interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
  style?: CSSProperties;
}

const sizeMap: Record<SpinnerSize, number> = {
  sm: 16,
  md: 24,
  lg: 32,
};

const colorMap: Record<SpinnerVariant, string> = {
  default: 'var(--text-muted)',
  primary: 'var(--primary-color)',
  white: '#ffffff',
  black: '#000000',
};

/**
 * Spinner component for loading states
 *
 * @example
 * <Spinner size="md" variant="primary" />
 */
export default function Spinner({
  size = 'md',
  variant = 'default',
  className = '',
  style,
}: SpinnerProps) {
  const spinnerSize = sizeMap[size];
  const color = colorMap[variant];

  return (
    <svg
      className={`spinner spinner-${size} spinner-${variant} ${className}`}
      width={spinnerSize}
      height={spinnerSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: 'spin 1s linear infinite',
        ...style,
      }}
      aria-label="Loading"
      role="status"
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
