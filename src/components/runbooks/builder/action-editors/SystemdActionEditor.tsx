'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import { FormSelect } from '../../RunbookControls';
import InputReferenceChips from '../InputReferenceChips';

interface SystemdActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs?: RunbookInputInput[];
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const SYSTEMD_ACTIONS = [
  { value: 'status', label: 'Status · inspect health (read-only)' },
  { value: 'logs', label: 'Logs · recent journal entries (read-only)' },
  { value: 'start', label: 'Start · start a stopped unit (safe write)' },
  { value: 'stop', label: 'Stop · halt the unit (safe write)' },
  { value: 'restart', label: 'Restart · full restart (needs approval)' },
];

export default function SystemdActionEditor({
  config,
  errors = {},
  inputs = [],
  editorId = 'systemd',
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
        <div className="space-y-1.5">
          <Label htmlFor={`systemd-action-${editorId}`} className="text-xs">
            Action
          </Label>
          <FormSelect
            name={`systemd-action-${editorId}`}
            label="Action"
            value={action}
            disabled={readOnly}
            onValueChange={(nextAction: string) => handleActionChange(nextAction)}
            options={SYSTEMD_ACTIONS}
          />
          {errors.action && <p className="text-xs text-destructive">{errors.action}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`systemd-unit-${editorId}`} className="text-xs">
            Service unit
          </Label>
          <Input
            id={`systemd-unit-${editorId}`}
            aria-label="Service unit or input reference"
            placeholder="e.g. nginx.service"
            value={unit}
            disabled={readOnly}
            onChange={e => onChange({ ...config, unit: e.target.value })}
            className={`font-mono text-xs ${errors.unit ? 'border-destructive' : ''}`}
          />
          {errors.unit ? (
            <p className="text-xs text-destructive">{errors.unit}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Include the unit suffix: .service, .socket, .timer…
            </p>
          )}
        </div>
      </div>

      <InputReferenceChips
        inputs={inputs.filter(input => input.type === 'STRING' || input.type === 'SELECT')}
        current={unit}
        readOnly={readOnly}
        onInsert={reference => onChange({ ...config, unit: reference })}
      />

      {isLogs && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor={`systemd-lines-${editorId}`} className="text-xs">
            Recent log lines
          </Label>
          <Input
            id={`systemd-lines-${editorId}`}
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
          {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
        </div>
      )}
    </div>
  );
}
