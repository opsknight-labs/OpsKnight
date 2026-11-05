'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';
import { OPSKNIGHT_BRAND_URL } from '@/lib/brand';

type AuthBrandSize = 'compact' | 'default' | 'hero';

type AuthBrandProps = {
  className?: string;
  /** @deprecated use `size="compact"` */
  compact?: boolean;
  size?: AuthBrandSize;
  /** `onDark` renders the wordmark in white for dark imagery panels. */
  tone?: 'auto' | 'onDark';
};

function logoClass(size: AuthBrandSize): string {
  switch (size) {
    case 'compact':
      return 'h-7 w-7';
    case 'hero':
      return 'h-8 w-8 2xl:h-10 2xl:w-10';
    default:
      return 'h-8 w-8';
  }
}

function wordmarkClass(size: AuthBrandSize): string {
  switch (size) {
    case 'compact':
      return 'text-base';
    case 'hero':
      return 'text-[clamp(1.25rem,4.5vw,1.5rem)] 2xl:text-3xl';
    default:
      return 'text-lg';
  }
}

/**
 * The OpsKnight brand lockup for public (unauthenticated) surfaces.
 *
 * Brand standard (AGENTS.md "Official Brand Logo" / "Official Brand Hyperlinks"):
 * the transparent logo is shown bare, never inside a filled box, and the
 * logo + wordmark always link to https://opsknight.com/.
 */
export default function AuthBrand({
  className,
  compact = false,
  size,
  tone = 'auto',
}: AuthBrandProps) {
  const resolvedSize: AuthBrandSize = size ?? (compact ? 'compact' : 'default');

  return (
    <a
      href={OPSKNIGHT_BRAND_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        tone === 'onDark'
          ? 'focus-visible:ring-white focus-visible:ring-offset-slate-950'
          : 'focus-visible:ring-slate-900 dark:focus-visible:ring-white',
        className
      )}
      aria-label="OpsKnight official website"
    >
      <Image
        src="/logo.png"
        alt="OpsKnight"
        width={40}
        height={40}
        className={cn('shrink-0 object-contain', logoClass(resolvedSize))}
        priority
        unoptimized
      />
      <span
        className={cn(
          'font-display font-bold tracking-tight',
          tone === 'onDark' ? 'text-white' : 'text-slate-950 dark:text-white',
          wordmarkClass(resolvedSize)
        )}
      >
        OpsKnight
      </span>
    </a>
  );
}
