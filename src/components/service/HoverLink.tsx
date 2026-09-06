'use client';

import Link from 'next/link';
import { useState } from 'react';

type HoverLinkProps = {
  href: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};

export default function HoverLink({ href, children, style, className }: HoverLinkProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Determine initial color from style prop or default
  const initialColor = style?.color || 'var(--text-muted)';
  const hoverColor =
    style?.color === 'var(--primary-color)' ? 'var(--primary-hover)' : 'var(--primary-color)';

  return (
    <Link
      href={href}
      className={className}
      style={{
        ...style,
        color: isHovered ? hoverColor : initialColor,
        transition: 'color 0.2s',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
    </Link>
  );
}
