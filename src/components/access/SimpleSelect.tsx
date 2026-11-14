'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { cn } from '@/lib/utils';

export type SimpleSelectOption = { value: string; label: string };

/** shadcn Select for a flat list of string options. Radix forbids empty values, so use a sentinel. */
export default function SimpleSelect({
  id,
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  className,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SimpleSelectOption[];
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('bg-background', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
