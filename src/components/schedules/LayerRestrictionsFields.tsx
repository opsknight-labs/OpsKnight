'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import { CalendarRange, ChevronDown, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';

type LayerRestrictionsFieldsProps = {
  selectedDays: number[];
  onSelectedDaysChange: (days: number[]) => void;
  startHour: string;
  onStartHourChange: (hour: string) => void;
  endHour: string;
  onEndHourChange: (hour: string) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
};

const DAYS = [
  { value: 0, short: 'S', label: 'Sunday' },
  { value: 1, short: 'M', label: 'Monday' },
  { value: 2, short: 'T', label: 'Tuesday' },
  { value: 3, short: 'W', label: 'Wednesday' },
  { value: 4, short: 'T', label: 'Thursday' },
  { value: 5, short: 'F', label: 'Friday' },
  { value: 6, short: 'S', label: 'Saturday' },
];

function restrictionSummary(selectedDays: number[], startHour: string, endHour: string) {
  const parts: string[] = [];
  if (selectedDays.length === 5 && [1, 2, 3, 4, 5].every(day => selectedDays.includes(day))) {
    parts.push('Weekdays');
  } else if (selectedDays.length === 2 && selectedDays.includes(0) && selectedDays.includes(6)) {
    parts.push('Weekends');
  } else if (selectedDays.length > 0 && selectedDays.length < 7) {
    parts.push(`${selectedDays.length} days`);
  }

  if (startHour && endHour) {
    parts.push(`${startHour.padStart(2, '0')}:00–${endHour.padStart(2, '0')}:00`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Every day, 24 hours';
}

export default function LayerRestrictionsFields({
  selectedDays,
  onSelectedDaysChange,
  startHour,
  onStartHourChange,
  endHour,
  onEndHourChange,
  disabled = false,
  defaultOpen = false,
}: LayerRestrictionsFieldsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasRestrictions = selectedDays.length > 0 || Boolean(startHour) || Boolean(endHour);

  const toggleDay = (day: number) => {
    onSelectedDaysChange(
      selectedDays.includes(day)
        ? selectedDays.filter(selectedDay => selectedDay !== day)
        : [...selectedDays, day]
    );
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-xl border bg-card">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarRange className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">Repeating coverage hours</p>
                <Badge variant={hasRestrictions ? 'info' : 'secondary'} size="xs">
                  {hasRestrictions ? 'Customized' : '24/7'}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {hasRestrictions
                  ? restrictionSummary(selectedDays, startHour, endHour)
                  : 'Always active (24/7)'}
              </p>
            </div>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <div className="space-y-5 border-t bg-muted/[0.12] p-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Active days</p>
                  <p className="text-xs text-muted-foreground">
                    These hours repeat after the first responder starts.
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectedDaysChange([1, 2, 3, 4, 5])}
                    disabled={disabled}
                    className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-500/20 dark:text-blue-300 disabled:opacity-50"
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectedDaysChange([0, 6])}
                    disabled={disabled}
                    className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300 disabled:opacity-50"
                  >
                    Weekends
                  </button>
                  {selectedDays.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onSelectedDaysChange([])}
                      disabled={disabled}
                      className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300 disabled:opacity-50"
                    >
                      Every day
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map(day => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    disabled={disabled}
                    aria-label={day.label}
                    aria-pressed={selectedDays.includes(day.value)}
                    className={cn(
                      'h-10 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                      selectedDays.includes(day.value)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    )}
                  >
                    {day.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Daily active hours</p>
                  <p className="text-xs text-muted-foreground">
                    Leave both empty to keep this layer active all day.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <select
                  name="restrictStartHour"
                  value={startHour}
                  onChange={event => onStartHourChange(event.target.value)}
                  disabled={disabled}
                  aria-label="Coverage starts at"
                  className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Start time</option>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {hour.toString().padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">to</span>
                <select
                  name="restrictEndHour"
                  value={endHour}
                  onChange={event => onEndHourChange(event.target.value)}
                  disabled={disabled}
                  aria-label="Coverage ends at"
                  className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">End time</option>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {hour.toString().padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onStartHourChange('9');
                    onEndHourChange('17');
                  }}
                  disabled={disabled}
                  className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300 disabled:opacity-50"
                >
                  Business hours
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onStartHourChange('18');
                    onEndHourChange('6');
                  }}
                  disabled={disabled}
                  className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-500/20 dark:text-indigo-300 disabled:opacity-50"
                >
                  Overnight
                </button>
                {(startHour || endHour) && (
                  <button
                    type="button"
                    onClick={() => {
                      onStartHourChange('');
                      onEndHourChange('');
                    }}
                    disabled={disabled}
                    className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300 disabled:opacity-50"
                  >
                    24 hours
                  </button>
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
