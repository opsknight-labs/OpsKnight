'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';

export function ManualSample({ onBuild }: { onBuild: (sample: string) => void }) {
  const [summary, setSummary] = useState('Sample incident');
  const [severity, setSeverity] = useState('critical');
  const [environment, setEnvironment] = useState('production');
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">Build sample manually</summary>
      <div className="grid gap-3 mt-3 sm:grid-cols-3">
        <label className="text-sm">
          Summary
          <Input value={summary} onChange={event => setSummary(event.target.value)} />
        </label>
        <label className="text-sm">
          Severity
          <select
            className={`${controlClass} block w-full`}
            value={severity}
            onChange={event => setSeverity(event.target.value)}
          >
            {['critical', 'error', 'warning', 'info'].map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Environment
          <Input value={environment} onChange={event => setEnvironment(event.target.value)} />
        </label>
        <Button
          onClick={() =>
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
            )
          }
        >
          Use manual sample
        </Button>
      </div>
    </details>
  );
}
