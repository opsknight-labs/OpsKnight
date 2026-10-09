'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Clock } from 'lucide-react';

interface WaitActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (remainingSecs === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainingSecs} second${remainingSecs === 1 ? '' : 's'}`;
}

export default function WaitActionEditor({
  config,
  errors = {},
  readOnly = false,
  onChange,
}: WaitActionEditorProps) {
  const rawDuration = config.durationSeconds;
  const numDuration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration);
  const hasValidNum = !Number.isNaN(numDuration) && numDuration > 0;

  const handleChange = (valStr: string) => {
    const nextConfig = { ...config };
    const trimmed = valStr.trim();
    if (trimmed === '') {
      delete nextConfig.durationSeconds;
    } else {
      const parsed = Number(trimmed);
      nextConfig.durationSeconds = Number.isNaN(parsed) ? trimmed : parsed;
    }
    onChange(nextConfig);
  };

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <Label htmlFor="wait-duration">Wait Duration (Seconds)</Label>
        <div className="mt-1.5">
          <Input
            id="wait-duration"
            aria-label="Wait duration (seconds)"
            type="number"
            min={1}
            max={3600}
            placeholder="e.g. 30"
            value={rawDuration === undefined || rawDuration === null ? '' : String(rawDuration)}
            disabled={readOnly}
            onChange={e => handleChange(e.target.value)}
            className={errors.durationSeconds ? 'border-destructive' : ''}
          />
        </div>
        {errors.durationSeconds && (
          <p className="mt-1 text-xs text-destructive">{errors.durationSeconds}</p>
        )}
      </div>

      {hasValidNum && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Pauses workflow execution for <strong>{formatDuration(numDuration)}</strong> before continuing to the next step.
          </span>
        </div>
      )}
    </div>
  );
}
