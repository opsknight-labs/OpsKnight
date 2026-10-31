'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Input } from '@/components/ui/shadcn/input';

const PRESETS = [
  { value: '1', label: '1 day (Strict compliance)' },
  { value: '7', label: '7 days (1 week)' },
  { value: '14', label: '14 days (2 weeks)' },
  { value: '30', label: '30 days (Recommended default)' },
  { value: '60', label: '60 days (Extended session)' },
  { value: '90', label: '90 days (Maximum allowed)' },
  { value: 'custom', label: 'Custom duration…' },
];

export default function SessionIdleSelect({ defaultValue = 30 }: { defaultValue?: number }) {
  const initialIsPreset = PRESETS.some(
    p => p.value !== 'custom' && Number(p.value) === defaultValue
  );
  const [selected, setSelected] = useState<string>(
    initialIsPreset ? String(defaultValue) : 'custom'
  );
  const [customDays, setCustomDays] = useState<number>(defaultValue);

  const effectiveDays = selected === 'custom' ? customDays : Number(selected);

  return (
    <div className="space-y-3">
      {/* Hidden input to ensure FormData always includes sessionIdleDays */}
      <input type="hidden" name="sessionIdleDays" value={effectiveDays} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="w-full sm:w-72">
          <Select
            value={selected}
            onValueChange={val => {
              setSelected(val);
              if (val !== 'custom') {
                setCustomDays(Number(val));
              }
            }}
          >
            <SelectTrigger
              id="mcp-session-idle-select"
              className="h-9 w-full rounded-lg border-border/80 bg-background text-xs font-medium focus:ring-1 focus:ring-primary"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Select session lifetime" />
              </div>
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="max-h-60 overflow-y-auto overscroll-contain rounded-xl border-border/80 shadow-xl"
            >
              {PRESETS.map(preset => (
                <SelectItem
                  key={preset.value}
                  value={preset.value}
                  className="rounded-lg text-xs font-medium cursor-pointer"
                >
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selected === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              id="mcp-custom-idle-days"
              type="number"
              min="1"
              max="90"
              value={customDays}
              onChange={e => setCustomDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
              className="h-9 w-24 text-xs tabular-nums"
              required
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">days (1–90)</span>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Active assistant interaction automatically extends the session via sliding renewal up to 90
        days maximum. Changing password or explicit revocation terminates it immediately.
      </p>
    </div>
  );
}
