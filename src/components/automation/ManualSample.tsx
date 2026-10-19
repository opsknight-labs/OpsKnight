'use client';
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { NativeSelect } from './authoring/primitives';

export function ManualSample({ onBuild }: { onBuild: (sample: string) => void }) {
  const id = useId();
  const [summary, setSummary] = useState('Sample incident');
  const [severity, setSeverity] = useState('critical');
  const [environment, setEnvironment] = useState('production');
  const [built, setBuilt] = useState(false);
  return (
    <details className="group rounded-lg border border-border/70 bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        Build sample manually
        <ChevronDown
          className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-3 border-t border-border/70 p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-summary`}>Summary</Label>
            <Input
              id={`${id}-summary`}
              value={summary}
              onChange={event => setSummary(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-severity`}>Severity</Label>
            <NativeSelect
              id={`${id}-severity`}
              value={severity}
              onChange={event => setSeverity(event.target.value)}
            >
              {['critical', 'error', 'warning', 'info'].map(value => (
                <option key={value}>{value}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-environment`}>Environment</Label>
            <Input
              id={`${id}-environment`}
              value={environment}
              onChange={event => setEnvironment(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              onBuild(
                JSON.stringify(
                  {
                    event_action: 'trigger',
                    dedup_key: 'manual-sample',
                    payload: {
                      summary,
                      severity,
                      source: 'manual-sample',
                      custom_details: { environment },
                    },
                  },
                  null,
                  2
                )
              );
              setBuilt(true);
            }}
          >
            Use manual sample
          </Button>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {built ? 'Sample event updated. Run Test sample to evaluate it.' : ''}
          </p>
        </div>
      </div>
    </details>
  );
}
