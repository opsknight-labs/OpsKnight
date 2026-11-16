'use client';

import { useState, ChangeEvent } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Calendar, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateTimeInputProps {
  name?: string;
  value?: string; // datetime-local format: YYYY-MM-DDTHH:mm
  onChange?: (value: string) => void; // for controlled usage
  min?: string;
  max?: string;
  required?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string; // Applied to inputs
}

function splitDateTime(value?: string) {
  if (!value) return { date: '', time: '' };
  const [d, t] = value.split('T');
  return { date: d || '', time: t || '' };
}

export default function DateTimeInput({
  name,
  value,
  onChange,
  min,
  max,
  required,
  fullWidth,
  disabled,
  className,
}: DateTimeInputProps) {
  // Parse initial value (YYYY-MM-DDTHH:mm)
  const [datePart, setDatePart] = useState(() => splitDateTime(value).date);
  const [timePart, setTimePart] = useState(() => splitDateTime(value).time);
  const [combinedValue, setCombinedValue] = useState(value || '');
  const [syncedValue, setSyncedValue] = useState(value);

  if (syncedValue !== value) {
    setSyncedValue(value);
    const { date, time } = splitDateTime(value);
    setDatePart(date);
    setTimePart(time);
    setCombinedValue(value || '');
  }

  const updateValue = (newDate: string, newTime: string) => {
    if (newDate && newTime) {
      const dateTime = `${newDate}T${newTime}`;
      setCombinedValue(dateTime);
      if (onChange) onChange(dateTime);
    } else {
      setCombinedValue('');
      if (onChange) onChange('');
    }
  };

  const handleDateChange = (e: ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value;
    setDatePart(d);
    updateValue(d, timePart);
  };

  const handleTimeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value;
    setTimePart(t);
    updateValue(datePart, t);
  };

  return (
    <div className={cn('flex gap-2', fullWidth ? 'w-full' : 'w-auto')}>
      {/* Hidden input for Form Data submission compatibility */}
      {name && <input type="hidden" name={name} value={combinedValue} />}

      {/* Date Input */}
      <div className="relative flex-grow">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">
          <Calendar className="h-4 w-4" />
        </div>
        <Input
          type="date"
          value={datePart}
          onChange={handleDateChange}
          required={required}
          min={min?.split('T')[0]}
          max={max?.split('T')[0]}
          disabled={disabled}
          className={cn('pl-9', className)}
        />
      </div>

      {/* Time Input */}
      <div className="relative w-1/3 min-w-[120px]">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">
          <Clock className="h-4 w-4" />
        </div>
        <Input
          type="time"
          value={timePart}
          onChange={handleTimeChange}
          required={required}
          disabled={disabled}
          className={cn('pl-9', className)}
        />
      </div>
    </div>
  );
}
