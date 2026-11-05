'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface BrandLockupProps {
  className?: string;
  showSubtitle?: boolean;
  isCollapsed?: boolean;
  variant?: 'header' | 'sidebar' | 'mobile';
}

export default function BrandLockup({
  className,
  isCollapsed = false,
  variant = 'header',
}: BrandLockupProps) {
  const isHeader = variant === 'header';

  return (
    <Link
      href="/"
      className={cn(
        'group flex items-center no-underline select-none transition-opacity hover:opacity-90',
        isCollapsed ? 'justify-center w-full' : 'gap-2.5',
        className
      )}
      aria-label="OpsKnight Home"
    >
      {/* Transparent logo, shown bare: brand standard forbids enclosing it in a
          filled box (AGENTS.md "Official Brand Logo"). */}
      <Image
        src="/logo.svg"
        alt="OpsKnight"
        width={36}
        height={36}
        className={cn(
          'shrink-0 object-contain transition-transform duration-200 group-hover:scale-105',
          isHeader ? 'h-8 w-8' : 'h-7 w-7'
        )}
        priority
      />

      {/* Brand Text */}
      {!isCollapsed && (
        <span
          role="heading"
          aria-level={1}
          className={cn(
            'font-extrabold font-display tracking-tight leading-none',
            isHeader ? 'text-[17.5px] text-white' : 'text-[16px] text-foreground'
          )}
        >
          OpsKnight
        </span>
      )}
    </Link>
  );
}
