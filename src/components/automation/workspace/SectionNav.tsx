'use client';
import { memo } from 'react';
import { Activity, Database, FlaskConical, History, Sliders, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Area } from '../presentation-types';
import { AREAS } from './constants';

const TAB_ICONS = new Map<Area, LucideIcon>([
  ['overview', Activity],
  ['context', Database],
  ['rules', Sliders],
  ['test', FlaskConical],
  ['activity', History],
]);

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
    <nav aria-label="Automation sections" className="overflow-x-auto pb-0.5">
      <div className="inline-flex min-w-full items-center gap-1 rounded-lg border border-border/70 bg-muted/40 p-1 sm:min-w-0">
        {AREAS.map(({ id, label }, index) => {
          const selected = area === id;
          const Icon = TAB_ICONS.get(id);
          return (
            <button
              key={id}
              type="button"
              aria-current={selected ? 'true' : undefined}
              title={`${label} (press ${index + 1})`}
              onClick={() => onSelect(id)}
              className={cn(
                'group inline-flex min-h-8.5 shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:flex-none',
                selected
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
              )}
            >
              {Icon && (
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 transition-colors',
                    selected ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                  aria-hidden="true"
                />
              )}
              <span>{label}</span>
              {id === 'rules' && errorCount > 0 && (
                <span
                  aria-hidden="true"
                  className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground shadow-xs"
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
