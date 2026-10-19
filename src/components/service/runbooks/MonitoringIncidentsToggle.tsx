'use client';

import { useId, useState } from 'react';
import { Switch } from '@/components/ui/shadcn/switch';
import { Label } from '@/components/ui/shadcn/label';

export default function MonitoringIncidentsToggle({
  defaultChecked = false,
}: {
  defaultChecked?: boolean;
}) {
  const id = useId();
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-background/60 p-3">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium">
          Run on monitoring incidents
        </Label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          When off, incidents opened by monitoring alerts never trigger this runbook. Manually
          created and API incidents are unaffected.
        </p>
      </div>
      <input type="hidden" name="runOnMonitoringIncidents" value={String(checked)} />
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={setChecked}
        aria-describedby={`${id}-help`}
      />
    </div>
  );
}
