'use client';

import { cn } from '@/lib/utils';
import { Radio } from 'lucide-react';

export type LivePulseBadgeProps = {
  isLive?: boolean;
  label?: string;
  className?: string;
  onClick?: () => void;
};

export default function LivePulseBadge({
  isLive = true,
  label = 'Live',
  className,
  onClick,
}: LivePulseBadgeProps) {
  const content = (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-md transition-all duration-200 shadow-sm',
        isLive
          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-400',
        onClick && 'cursor-pointer hover:scale-105 active:scale-95',
        className
      )}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
    >
      <span className="relative flex h-2 w-2">
        {isLive && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            isLive ? 'bg-emerald-500' : 'bg-slate-400'
          )}
        />
      </span>
      <span className="tracking-wide uppercase text-[10px] font-bold">{label}</span>
      <Radio className="h-3 w-3 opacity-60 ml-0.5" />
    </div>
  );

  return content;
}
