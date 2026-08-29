'use client';

import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { useState } from 'react';
import { Calendar, ChevronDown, Info, Repeat, SlidersHorizontal } from 'lucide-react';

type LayerTimingFieldsProps = {
  rotationDuration: string;
  onRotationDurationChange: (value: string) => void;
  shiftDuration: string;
  onShiftDurationChange: (value: string) => void;
  startDefaultValue: string;
  endDefaultValue?: string;
  disabled?: boolean;
  rotationSummary?: string | null;
  timeZone?: string;
};

const rotationPresets = [
  { hours: 12, label: '12h' },
  { hours: 24, label: 'Daily' },
  { hours: 168, label: 'Weekly' },
  { hours: 336, label: '2 weeks' },
];

export default function LayerTimingFields({
  rotationDuration,
  onRotationDurationChange,
  shiftDuration,
  onShiftDurationChange,
  startDefaultValue,
  endDefaultValue = '',
  disabled = false,
  rotationSummary,
  timeZone,
}: LayerTimingFieldsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(shiftDuration));
  const shiftHours = Number(shiftDuration);
  const rotationHours = Number(rotationDuration);
  const leavesLayerInactive =
    Number.isFinite(shiftHours) &&
    Number.isFinite(rotationHours) &&
    shiftHours > 0 &&
    rotationHours > shiftHours;

  return (
    <>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b bg-muted/[0.12] p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Repeat className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Responder handoff</h3>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="About handoff frequency">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[280px]">
                    How often coverage moves to the next responder in the configured order.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose when the next responder takes over this layer.
            </p>
          </div>
        </div>

        <div className="space-y-5 p-4">
          <div className="space-y-3">
            <Label>Change responder every</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {rotationPresets.map(({ hours, label }) => (
                <Button
                  key={hours}
                  type="button"
                  variant={rotationDuration === hours.toString() ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onRotationDurationChange(hours.toString())}
                  disabled={disabled}
                  className="text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Custom responder handoff interval"
                type="number"
                name="rotationLengthHours"
                value={rotationDuration}
                onChange={event => onRotationDurationChange(event.target.value)}
                required
                min="1"
                disabled={disabled}
                className="h-10 w-24"
              />
              <span className="text-sm text-muted-foreground">hours</span>
              {rotationSummary && (
                <span className="ml-auto text-xs text-muted-foreground">{rotationSummary}</span>
              )}
            </div>
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/[0.045] p-3 text-left transition-colors hover:border-primary/55 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    Set a limited layer duration
                    <Badge variant="secondary" size="xs">
                      Advanced
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Use this only when another layer covers part of the handoff interval.
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-primary transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div className="space-y-2 rounded-lg bg-muted/[0.25] p-3">
                <Label htmlFor="layer-active-for">This layer is active for</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="layer-active-for"
                    aria-label="Layer active duration"
                    type="number"
                    name="shiftLengthHours"
                    value={shiftDuration}
                    onChange={event => onShiftDurationChange(event.target.value)}
                    min="1"
                    placeholder="Entire handoff"
                    disabled={disabled}
                    className="h-10 w-40 bg-background"
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
                {leavesLayerInactive ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    This layer is inactive for {rotationHours - shiftHours} hours before its next
                    handoff. Another layer can cover that time.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Leave blank to keep this layer active until the next responder handoff.
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <h4 className="text-sm font-semibold">Rotation start and end</h4>
                <p className="text-xs text-muted-foreground">
                  This sets the first handoff; it does not limit daily coverage hours.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>First responder starts</Label>
                <input
                  aria-label="Layer starts"
                  type="datetime-local"
                  name="start"
                  defaultValue={startDefaultValue}
                  required
                  disabled={disabled}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {timeZone && <p className="text-xs text-muted-foreground">Times use {timeZone}.</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  Rotation ends
                  <Badge variant="secondary" size="xs">
                    Optional
                  </Badge>
                </Label>
                <input
                  aria-label="Layer ends"
                  type="datetime-local"
                  name="end"
                  defaultValue={endDefaultValue}
                  disabled={disabled}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
