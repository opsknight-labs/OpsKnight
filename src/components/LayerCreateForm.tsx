'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Layers,
  Loader2,
  Plus,
  Info,
  Clock,
  Calendar,
  Users,
  Repeat,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import LayerTimingFields from '@/components/schedules/LayerTimingFields';

type LayerCreateFormProps = {
  scheduleId: string;
  canManageSchedules: boolean;
  createLayer: (scheduleId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  defaultStartDate: string;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function LayerCreateForm({
  scheduleId,
  canManageSchedules,
  createLayer,
  defaultStartDate,
}: LayerCreateFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Form state
  const [rotationDuration, setRotationDuration] = useState<string>('168');
  const [shiftDuration, setShiftDuration] = useState<string>('');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startHour, setStartHour] = useState<string>('');
  const [endHour, setEndHour] = useState<string>('');

  // Computed preview info
  const rotationInfo = useMemo(() => {
    const hours = parseInt(rotationDuration) || 0;
    if (hours <= 0) return null;

    if (hours < 24) return `${hours} hour rotation`;
    if (hours === 24) return 'Daily rotation';
    if (hours === 168) return 'Weekly rotation';
    if (hours === 336) return 'Bi-weekly rotation';
    if (hours % 24 === 0) return `${hours / 24} day rotation`;
    return `${hours} hour rotation`;
  }, [rotationDuration]);

  const shiftInfo = useMemo(() => {
    const hours = parseInt(shiftDuration) || 0;
    if (hours <= 0) return null;
    return `${hours}h active per rotation`;
  }, [shiftDuration]);

  const restrictionInfo = useMemo(() => {
    const parts: string[] = [];

    if (selectedDays.length > 0 && selectedDays.length < 7) {
      const isWeekdays =
        selectedDays.length === 5 && [1, 2, 3, 4, 5].every(d => selectedDays.includes(d));
      const isWeekends =
        selectedDays.length === 2 && selectedDays.includes(0) && selectedDays.includes(6);

      if (isWeekdays) parts.push('Weekdays only');
      else if (isWeekends) parts.push('Weekends only');
      else parts.push(`${selectedDays.length} days/week`);
    }

    if (startHour && endHour) {
      parts.push(`${startHour.padStart(2, '0')}:00-${endHour.padStart(2, '0')}:00`);
    }

    return parts.length > 0 ? parts.join(' • ') : null;
  }, [selectedDays, startHour, endHour]);

  const toggleDay = (day: number) => {
    setSelectedDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const setWeekdays = () => setSelectedDays([1, 2, 3, 4, 5]);
  const setWeekends = () => setSelectedDays([0, 6]);
  const clearDays = () => setSelectedDays([]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    // Add selected days to form data
    selectedDays.forEach(day => {
      formData.append('daysOfWeek', day.toString());
    });

    startTransition(async () => {
      try {
        const result = await createLayer(scheduleId, formData);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast('Layer created successfully', 'success');
          setOpen(false);
          // Reset form state
          setSelectedDays([]);
          setStartHour('');
          setEndHour('');
          setShiftDuration('');
          router.refresh();
        }
      } catch {
        showToast('Failed to create layer', 'error');
      }
    });
  };

  if (!canManageSchedules) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="w-full h-10 gap-2 text-sm font-medium shadow-sm">
          <Plus className="h-4 w-4" />
          Add Rotation
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        {/* Header */}
        <SheetHeader className="pb-4 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <SheetTitle className="text-lg font-semibold">Add Rotation Layer</SheetTitle>
              <SheetDescription>Create a new on-call rotation schedule</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Live Preview Card */}
        <div className="mb-6 p-4 rounded-xl bg-slate-50/80 border border-slate-200/80">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-slate-700">Live Preview</span>
            </div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">Auto-updates</span>
          </div>
          <div className="flex flex-wrap gap-2 min-h-[28px]">
            {rotationInfo && (
              <Badge variant="secondary" className="gap-1.5">
                <Clock className="h-3 w-3" />
                {rotationInfo}
              </Badge>
            )}
            {shiftInfo && (
              <Badge
                variant="outline"
                className="gap-1.5 border-orange-200 bg-orange-50 text-orange-700"
              >
                <AlertCircle className="h-3 w-3" />
                {shiftInfo}
              </Badge>
            )}
            {restrictionInfo && (
              <Badge
                variant="outline"
                className="gap-1.5 border-purple-200 bg-purple-50 text-purple-700"
              >
                <Calendar className="h-3 w-3" />
                {restrictionInfo}
              </Badge>
            )}
            {!rotationInfo && !shiftInfo && !restrictionInfo && (
              <span className="text-xs text-slate-400">Configure settings below...</span>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Layer Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              Layer Name
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="e.g. Primary On-Call, Weekend Coverage"
              required
              disabled={isPending}
              className="h-11"
            />
            <p className="text-[11px] text-slate-500">Give this rotation a descriptive name</p>
          </div>

          <LayerTimingFields
            rotationDuration={rotationDuration}
            onRotationDurationChange={setRotationDuration}
            shiftDuration={shiftDuration}
            onShiftDurationChange={setShiftDuration}
            startDefaultValue={defaultStartDate}
            disabled={isPending}
            rotationSummary={rotationInfo}
          />

          {/* Restrictions Section */}
          <div className="space-y-4 p-4 rounded-xl bg-purple-50/50 border border-purple-100">
            <div className="flex items-center gap-2">
              <Label className="flex items-center gap-2 text-purple-900">
                <AlertCircle className="h-4 w-4" />
                Restrictions
                <Badge
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700"
                >
                  Optional
                </Badge>
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-purple-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[280px]">
                    <p>
                      Limit when this layer is active. Great for business-hours-only or weekday
                      coverage.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Days of Week */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-purple-700 font-medium">Active Days</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={setWeekdays}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded font-medium transition-colors',
                      selectedDays.length === 5 &&
                        [1, 2, 3, 4, 5].every(d => selectedDays.includes(d))
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                    )}
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    onClick={setWeekends}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded font-medium transition-colors',
                      selectedDays.length === 2 &&
                        selectedDays.includes(0) &&
                        selectedDays.includes(6)
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                    )}
                  >
                    Weekends
                  </button>
                  {selectedDays.length > 0 && (
                    <button
                      type="button"
                      onClick={clearDays}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {DAY_SHORT.map((day, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    disabled={isPending}
                    className={cn(
                      'h-10 rounded-lg text-sm font-semibold transition-all',
                      selectedDays.includes(i)
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-white border-2 border-purple-200 text-purple-400 hover:border-purple-300 hover:text-purple-600'
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-purple-500 px-1">
                {DAY_LABELS.map((day, i) => (
                  <span key={i} className="w-[calc(100%/7)] text-center">
                    {day}
                  </span>
                ))}
              </div>
            </div>

            {/* Time Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-purple-700 font-medium">Active Hours</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStartHour('9');
                      setEndHour('17');
                    }}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded font-medium transition-colors',
                      startHour === '9' && endHour === '17'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                    )}
                  >
                    9-5
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStartHour('18');
                      setEndHour('6');
                    }}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded font-medium transition-colors',
                      startHour === '18' && endHour === '6'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 hover:bg-purple-200 text-purple-700'
                    )}
                  >
                    Nights
                  </button>
                  {(startHour || endHour) && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartHour('');
                        setEndHour('');
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  name="restrictStartHour"
                  value={startHour}
                  onChange={e => setStartHour(e.target.value)}
                  disabled={isPending}
                  className="flex-1 h-10 text-sm rounded-lg border-2 border-purple-200 bg-white px-3 hover:border-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 cursor-pointer"
                >
                  <option value="">Start time</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {i.toString().padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
                <span className="text-sm text-purple-400 font-medium">to</span>
                <select
                  name="restrictEndHour"
                  value={endHour}
                  onChange={e => setEndHour(e.target.value)}
                  disabled={isPending}
                  className="flex-1 h-10 text-sm rounded-lg border-2 border-purple-200 bg-white px-3 hover:border-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 cursor-pointer"
                >
                  <option value="">End time</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {i.toString().padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-purple-500">Leave empty for 24-hour coverage</p>
            </div>
          </div>

          {/* Tip */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50/80 border border-blue-100 text-xs text-blue-700">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Next step:</strong> After creating, add team members to the rotation and set
              their order.
            </span>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-4 mt-2 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-10"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1 h-10 shadow-sm" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Layer'
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
