'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import { FormSelect } from '../../RunbookControls';
import InputReferenceChips from '../InputReferenceChips';

interface DockerActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs?: RunbookInputInput[];
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const DOCKER_ACTIONS = [
  { value: 'inspect', label: 'Inspect · container metadata (read-only)' },
  { value: 'health', label: 'Health · health-check status (read-only)' },
  { value: 'logs', label: 'Logs · recent output (read-only)' },
  { value: 'start', label: 'Start · start a stopped container (safe write)' },
  { value: 'stop', label: 'Stop · halt the container (safe write)' },
  { value: 'restart', label: 'Restart · restart the container (needs approval)' },
];

const RUNTIMES = [
  { value: 'docker', label: 'Docker' },
  { value: 'podman', label: 'Podman' },
];

export default function DockerActionEditor({
  config,
  errors = {},
  inputs = [],
  editorId = 'docker',
  readOnly = false,
  onChange,
}: DockerActionEditorProps) {
  const runtime = String(config.runtime ?? 'docker');
  const action = String(config.action ?? 'inspect');
  const container = String(config.container ?? '');

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`docker-runtime-${editorId}`} className="text-xs">
            Runtime
          </Label>
          <FormSelect
            name={`docker-runtime-${editorId}`}
            label="Runtime"
            value={runtime}
            disabled={readOnly}
            onValueChange={(nextRuntime: string) => onChange({ ...config, runtime: nextRuntime })}
            options={RUNTIMES}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`docker-action-${editorId}`} className="text-xs">
            Action
          </Label>
          <FormSelect
            name={`docker-action-${editorId}`}
            label="Action"
            value={action}
            disabled={readOnly}
            onValueChange={(nextAction: string) => onChange({ ...config, action: nextAction })}
            options={DOCKER_ACTIONS}
          />
          {errors.action && <p className="text-xs text-destructive">{errors.action}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`docker-container-${editorId}`} className="text-xs">
            Container name or ID
          </Label>
          <Input
            id={`docker-container-${editorId}`}
            aria-label="Container or input reference"
            placeholder="e.g. redis-cache"
            value={container}
            disabled={readOnly}
            onChange={e => onChange({ ...config, container: e.target.value })}
            className={`font-mono text-xs ${errors.container ? 'border-destructive' : ''}`}
          />
          {errors.container && <p className="text-xs text-destructive">{errors.container}</p>}
        </div>
      </div>
      <InputReferenceChips
        inputs={inputs.filter(input => input.type === 'STRING' || input.type === 'SELECT')}
        current={container}
        readOnly={readOnly}
        onInsert={reference => onChange({ ...config, container: reference })}
      />
    </div>
  );
}
