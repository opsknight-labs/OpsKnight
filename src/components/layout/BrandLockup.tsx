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
      {/* Shield Icon Box */}
      <div
        className={cn(
          'relative shrink-0 rounded-lg flex items-center justify-center overflow-hidden transition-all duration-200',
          isHeader
            ? 'h-9 w-9 bg-slate-900 border border-slate-700/80 shadow-sm group-hover:border-slate-500'
            : 'h-8.5 w-8.5 bg-slate-900 dark:bg-slate-800 border border-slate-700/60 shadow-xs group-hover:border-slate-600'
        )}
      >
        <Image
          src="/logo.svg"
          alt="OpsKnight"
          width={36}
          height={36}
          className={cn(
            'relative z-10 object-contain transition-transform duration-200 group-hover:scale-105',
            isHeader ? 'h-7 w-7' : 'h-6 w-6'
          )}
          priority
        />
      </div>

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
