'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '../../RunbookControls';

interface DockerActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const DOCKER_ACTIONS = [
  { value: 'inspect', label: 'Inspect (Container JSON metadata - Read Only)' },
  { value: 'health', label: 'Health (Health check status - Read Only)' },
  { value: 'logs', label: 'Logs (Container output tail - Read Only)' },
  { value: 'start', label: 'Start (Start stopped container - Idempotent Write)' },
  { value: 'stop', label: 'Stop (Halt container - Idempotent Write)' },
  { value: 'restart', label: 'Restart (Restart container - Approval Required)' },
];

const RUNTIMES = [
  { value: 'docker', label: 'Docker' },
  { value: 'podman', label: 'Podman' },
];

export default function DockerActionEditor({
  config,
  errors = {},
  readOnly = false,
  onChange,
}: DockerActionEditorProps) {
  const runtime = String(config.runtime ?? 'docker');
  const action = String(config.action ?? 'inspect');
  const container = String(config.container ?? '');

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="docker-runtime">Container Runtime</Label>
          <div className="mt-1.5">
            <FormSelect
              name="docker-runtime"
              label="Runtime"
              value={runtime}
              disabled={readOnly}
              onValueChange={(nextRuntime: string) => onChange({ ...config, runtime: nextRuntime })}
              options={RUNTIMES}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="docker-action">Action</Label>
          <div className="mt-1.5">
            <FormSelect
              name="docker-action"
              label="Action"
              value={action}
              disabled={readOnly}
              onValueChange={(nextAction: string) => onChange({ ...config, action: nextAction })}
              options={DOCKER_ACTIONS}
            />
          </div>
          {errors.action && <p className="mt-1 text-xs text-destructive">{errors.action}</p>}
        </div>

        <div>
          <Label htmlFor="docker-container">Container Name / ID</Label>
          <div className="mt-1.5">
            <Input
              id="docker-container"
              aria-label="Container or input reference"
              placeholder="e.g. redis-cache"
              value={container}
              disabled={readOnly}
              onChange={e => onChange({ ...config, container: e.target.value })}
              className={errors.container ? 'border-destructive' : ''}
            />
          </div>
          {errors.container && <p className="mt-1 text-xs text-destructive">{errors.container}</p>}
        </div>
      </div>
    </div>
  );
}
