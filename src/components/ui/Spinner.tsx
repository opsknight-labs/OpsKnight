'use client';

import { CSSProperties } from 'react';

type SpinnerSize = 'sm' | 'md' | 'lg';
type SpinnerVariant = 'default' | 'primary' | 'white' | 'black' | 'current';

interface SpinnerProps {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
  className?: string;
  style?: CSSProperties;
}

function getSpinnerSize(size: SpinnerSize): number {
  switch (size) {
    case 'sm':
      return 16;
    case 'lg':
      return 32;
    case 'md':
    default:
      return 24;
  }
}

function getSpinnerColor(variant: SpinnerVariant): string {
  switch (variant) {
    case 'primary':
      return 'var(--primary-color)';
    case 'white':
      return '#ffffff';
    case 'black':
      return '#000000';
    case 'current':
      return 'currentColor';
    case 'default':
    default:
      return 'var(--text-muted)';
  }
}

export default function Spinner({
  size = 'md',
  variant = 'default',
  className = '',
  style,
}: SpinnerProps) {
  const spinnerSize = getSpinnerSize(size);
  const spinnerColor = getSpinnerColor(variant);

  return (
    <svg
      className={`spinner spinner-${size} spinner-${variant} ${className}`}
      width={spinnerSize}
      height={spinnerSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke={spinnerColor}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: 'spin 1s linear infinite', ...style }}
      aria-label="Loading"
      role="status"
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
