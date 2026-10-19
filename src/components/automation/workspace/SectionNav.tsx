'use client';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { Area } from '../presentation-types';
import { AREAS } from './constants';

/** Segmented section switcher; buttons keep their plain names so selectors stay stable. */
export const SectionNav = memo(function SectionNav({
  area,
  onSelect,
  errorCount,
}: {
  area: Area;
  onSelect: (area: Area) => void;
  errorCount: number;
}) {
  return (
    <nav aria-label="Automation sections" className="overflow-x-auto pb-1">
      <div className="inline-flex min-w-full gap-1 rounded-lg border bg-muted/50 p-1 sm:min-w-0">
        {AREAS.map(({ id, label }) => {
          const selected = area === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(id)}
              className={cn(
                'inline-flex min-h-10 shrink-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background sm:flex-none',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
              )}
            >
              {label}
              {id === 'rules' && errorCount > 0 && (
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground"
                >
                  {errorCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
});
