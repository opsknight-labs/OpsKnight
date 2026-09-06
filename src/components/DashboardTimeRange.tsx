'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { Button } from '@/components/ui/shadcn/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/shadcn/popover';
import { cn } from '@/lib/utils';
import { CalendarIcon, X } from 'lucide-react';

const timeRangeOptions = [
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

type DashboardTimeRangeProps = {
  tone?: 'dark' | 'light';
  showLabel?: boolean;
};

export default function DashboardTimeRange({
  tone = 'dark',
  showLabel = true,
}: DashboardTimeRangeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { userTimeZone } = useTimezone();
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  // Local state for custom date inputs
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const currentRange = searchParams.get('range') || '30';
  const customStartParam = searchParams.get('startDate');
  const customEndParam = searchParams.get('endDate');

  useEffect(() => {
    if (!showCustomPicker) return;
    setCustomStart(customStartParam || '');
    setCustomEnd(customEndParam || '');
  }, [customStartParam, customEndParam, showCustomPicker]);

  const handleRangeChange = (range: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (range === 'all') {
      params.set('range', 'all');
      params.delete('startDate');
      params.delete('endDate');
    } else {
      params.set('range', range);
      params.delete('startDate');
      params.delete('endDate');
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleCustomApply = () => {
    const start = customStart || customStartParam;
    const end = customEnd || customEndParam;
    if (start && end) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('range', 'custom');
      params.set('startDate', start);
      params.set('endDate', end);
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
      setShowCustomPicker(false);
    }
  };

  const handleCustomClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    const params = new URLSearchParams(searchParams.toString());
    params.delete('range');
    params.delete('startDate');
    params.delete('endDate');
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
    setCustomStart('');
    setCustomEnd('');
  };

  const isSelected = (value: string) => {
    return currentRange === value && !customStartParam;
  };

  const isCustomSelected = !!customStartParam;
  const textClass = tone === 'dark' ? 'text-white/95' : 'text-slate-700';
  const pillClass = tone === 'dark' ? 'bg-white/10 border-white/10' : 'bg-slate-100 border-border/60';
  const buttonSelectedClass =
    tone === 'dark'
      ? 'bg-white/20 text-white shadow-sm font-bold'
      : 'bg-white text-slate-900 shadow-sm font-bold border border-border/60';
  const buttonDefaultClass =
    tone === 'dark'
      ? 'text-white/70 hover:text-white hover:bg-white/10'
      : 'text-slate-600 hover:text-slate-900 hover:bg-white';

  return (
    <div className="flex items-center gap-3 flex-wrap relative">
      {showLabel && (
        <span className={cn('text-[0.95rem] font-semibold', textClass)}>
          Time Range:
        </span>
      )}

      <div className={cn('flex items-center gap-2 p-1 rounded-lg backdrop-blur-sm border', pillClass)}>
        {timeRangeOptions.map(option => (
          <Button
            key={option.value}
            onClick={() => handleRangeChange(option.value)}
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 px-3 text-xs font-medium transition-all rounded-md',
              isSelected(option.value)
                ? buttonSelectedClass
                : buttonDefaultClass
            )}
          >
            {option.label}
          </Button>
        ))}

        <Popover open={showCustomPicker} onOpenChange={setShowCustomPicker}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 px-3 text-xs font-medium transition-all gap-2 rounded-md',
                isCustomSelected
                  ? buttonSelectedClass
                  : buttonDefaultClass
              )}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {isCustomSelected ? (
                <>
                  {formatDateTime(customStartParam || '', userTimeZone, { format: 'date' })} -{' '}
                  {formatDateTime(customEndParam || '', userTimeZone, { format: 'date' })}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={handleCustomClear}
                    className="ml-1 p-0.5 hover:bg-white/20 rounded-full"
                  >
                    <X className="h-3 w-3" />
                  </div>
                </>
              ) : (
                'Custom'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-4" align="end">
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Select Custom Range</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                  <input
                    type="date"
                    value={customStart || customStartParam || ''}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">End Date</label>
                  <input
                    type="date"
                    value={customEnd || customEndParam || ''}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCustomPicker(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!(customStart || customStartParam) || !(customEnd || customEndParam)}
                  onClick={handleCustomApply}
                >
                  Apply Range
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
