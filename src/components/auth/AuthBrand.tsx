'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

type AuthBrandProps = {
  className?: string;
  compact?: boolean;
};

export default function AuthBrand({ className, compact = false }: AuthBrandProps) {
  return (
    <a
      href="https://opsknight.com/"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white focus-visible:ring-offset-2',
        className
      )}
      aria-label="OpsKnight official website"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-200 bg-red-50 p-1 dark:border-red-500/30 dark:bg-red-950/50">
        <Image src="/logo.png" alt="" width={28} height={28} className="h-6 w-6 object-contain" />
      </span>
      <span
        className={cn(
          "font-['Space_Grotesk',sans-serif] font-bold tracking-tight text-slate-950 dark:text-white",
          compact ? 'text-base' : 'text-lg'
        )}
      >
        OpsKnight
      </span>
    </a>
  );
}
