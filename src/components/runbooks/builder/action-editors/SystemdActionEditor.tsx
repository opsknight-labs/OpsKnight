'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '../../RunbookControls';

interface SystemdActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const SYSTEMD_ACTIONS = [
  { value: 'status', label: 'Status (Inspect service health - Read Only)' },
  { value: 'start', label: 'Start (Start stopped service - Idempotent Write)' },
  { value: 'stop', label: 'Stop (Halt service - Idempotent Write)' },
  { value: 'restart', label: 'Restart (Full restart - Non-Idempotent / Approval Required)' },
  { value: 'logs', label: 'Logs (Recent journal entries - Read Only)' },
];

export default function SystemdActionEditor({
  config,
  errors = {},
  readOnly = false,
  onChange,
}: SystemdActionEditorProps) {
  const action = String(config.action ?? 'status');
  const unit = String(config.unit ?? '');
  const rawLines = config.lines;
  const isLogs = action === 'logs';

  const handleActionChange = (nextAction: string) => {
    const nextConfig: Record<string, unknown> = { ...config, action: nextAction };
    if (nextAction !== 'logs') {
      delete nextConfig.lines;
    }
    onChange(nextConfig);
  };

  const handleLinesChange = (valStr: string) => {
    const nextConfig: Record<string, unknown> = { ...config };
    const trimmed = valStr.trim();
    if (trimmed === '') {
      delete nextConfig.lines;
    } else {
      const parsed = Number(trimmed);
      nextConfig.lines = Number.isNaN(parsed) ? trimmed : parsed;
    }
    onChange(nextConfig);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="systemd-action">Systemd Action</Label>
          <div className="mt-1.5">
            <FormSelect
              name="systemd-action"
              label="Action"
              value={action}
              disabled={readOnly}
              onValueChange={(nextAction: string) => handleActionChange(nextAction)}
              options={SYSTEMD_ACTIONS}
            />
          </div>
          {errors.action && <p className="mt-1 text-xs text-destructive">{errors.action}</p>}
        </div>

        <div>
          <Label htmlFor="systemd-unit">Service Unit</Label>
          <div className="mt-1.5">
            <Input
              id="systemd-unit"
              aria-label="Service unit or input reference"
              placeholder="e.g. nginx.service or ${{ inputs.unit }}"
              value={unit}
              disabled={readOnly}
              onChange={e => onChange({ ...config, unit: e.target.value })}
              className={errors.unit ? 'border-destructive' : ''}
            />
          </div>
          {errors.unit ? (
            <p className="mt-1 text-xs text-destructive">{errors.unit}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Must end with valid systemd extension: .service, .socket, .timer, etc.
            </p>
          )}
        </div>
      </div>

      {isLogs && (
        <div className="max-w-xs">
          <Label htmlFor="systemd-lines">Recent Log Lines</Label>
          <div className="mt-1.5">
            <Input
              id="systemd-lines"
              aria-label="Recent log lines (maximum 500)"
              type="number"
              min={1}
              max={500}
              placeholder="e.g. 50 (max 500)"
              value={rawLines === undefined || rawLines === null ? '' : String(rawLines)}
              disabled={readOnly}
              onChange={e => handleLinesChange(e.target.value)}
              className={errors.lines ? 'border-destructive' : ''}
            />
          </div>
          {errors.lines && <p className="mt-1 text-xs text-destructive">{errors.lines}</p>}
        </div>
      )}
    </div>
  );
}
