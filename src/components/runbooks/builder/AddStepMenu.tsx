'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import type { RunbookStepType } from '@/lib/runbooks/types';
import { STEP_CATALOG, STEP_CATEGORIES } from './step-catalog';

export default function AddStepMenu({
  onAddStep,
  label = 'Add Step',
}: {
  onAddStep: (type: RunbookStepType) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-between gap-1.5 rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>{label}</span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(70vh,520px)] w-[min(92vw,360px)] overflow-y-auto p-1"
      >
        <div role="group" aria-label="Step types" className="space-y-1">
          {STEP_CATEGORIES.map(category => (
            <div key={category.label} role="group" aria-label={category.label} className="py-1">
              <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category.label}
              </p>
              <div className="space-y-0.5">
                {category.types.map(type => {
                  // eslint-disable-next-line security/detect-object-injection -- type is a closed union of known step types
                  const entry = STEP_CATALOG[type];
                  const Icon = entry.icon;
                  const descriptionId = `add-step-${type}-description`;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-label={entry.label}
                      aria-describedby={descriptionId}
                      onClick={() => {
                        onAddStep(type);
                        setOpen(false);
                      }}
                      className="flex min-h-8 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                    >
                      <Icon
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block">{entry.label}</span>
                        <span
                          id={descriptionId}
                          className="block text-xs leading-snug text-muted-foreground"
                        >
                          {entry.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
