'use client';

import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { Calendar, Clock, Info, Repeat } from 'lucide-react';

type LayerTimingFieldsProps = {
  rotationDuration: string;
  onRotationDurationChange: (value: string) => void;
  shiftDuration: string;
  onShiftDurationChange: (value: string) => void;
  startDefaultValue: string;
  endDefaultValue?: string;
  disabled?: boolean;
  rotationSummary?: string | null;
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
}: LayerTimingFieldsProps) {
  return (
    <>
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-muted-foreground" />
          Handoff frequency
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
        </Label>
        <div className="grid grid-cols-4 gap-2">
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

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Coverage duration
          <Badge variant="secondary" size="xs">
            Optional
          </Badge>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            name="shiftLengthHours"
            value={shiftDuration}
            onChange={event => onShiftDurationChange(event.target.value)}
            min="1"
            placeholder="Same as handoff"
            disabled={disabled}
            className="h-10 w-40"
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
        <p className="text-xs text-muted-foreground">
          A shorter duration intentionally creates an uncovered interval before the next handoff.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" /> Starts
          </Label>
          <input
            type="datetime-local"
            name="start"
            defaultValue={startDefaultValue}
            required
            disabled={disabled}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" /> Ends
            <Badge variant="secondary" size="xs">
              Optional
            </Badge>
          </Label>
          <input
            type="datetime-local"
            name="end"
            defaultValue={endDefaultValue}
            disabled={disabled}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
    </>
  );
}
