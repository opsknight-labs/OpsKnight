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
        <Button type="button" variant="outline" size="sm" className="w-full justify-center gap-1.5">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
          <ChevronDown className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(70vh,520px)] w-[min(92vw,340px)] overflow-y-auto p-1.5"
      >
        <div role="group" aria-label="Step types">
          {STEP_CATEGORIES.map(category => (
            <div key={category.label} role="group" aria-label={category.label} className="py-1">
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
                {category.label}
              </p>
              {category.types.map(type => {
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
                    className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {entry.label}
                      </span>
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
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
