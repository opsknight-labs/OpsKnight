'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '../../RunbookControls';

interface LinuxDiagnosticsEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const DIAGNOSTICS = [
  { value: 'summary', label: 'System Summary (CPU, Memory, Disk overview)' },
  { value: 'disk', label: 'Disk Usage (Mounts and free blocks)' },
  { value: 'memory', label: 'Memory Details (Buffers, cache, swap)' },
  { value: 'processes', label: 'Top Processes (High CPU / RSS consumption)' },
  { value: 'network', label: 'Network Interfaces (Link state and traffic)' },
  { value: 'listeners', label: 'Listening Sockets (Open ports)' },
  { value: 'dns', label: 'DNS Resolution (Query test)' },
  { value: 'tcp', label: 'TCP Connectivity (Port reachability)' },
  { value: 'http', label: 'Local HTTP Probe (Endpoint status)' },
  { value: 'journal', label: 'Systemd Journal (Service logs)' },
  { value: 'process', label: 'Process Pattern Search (pgrep match)' },
  { value: 'filesystem', label: 'Filesystem Path Check' },
];

export default function LinuxDiagnosticsEditor({
  config,
  errors = {},
  editorId = 'diag',
  readOnly = false,
  onChange,
}: LinuxDiagnosticsEditorProps) {
  const diagnostic = String(config.diagnostic ?? 'summary');

  const handleDiagnosticChange = (nextDiag: string) => {
    // Retain only diagnostic key and reset others to prevent hidden invalid configs
    onChange({ diagnostic: nextDiag });
  };

  const handleNumberChange = (key: 'lines' | 'port' | 'expectedStatus', valStr: string) => {
    const nextConfig = { ...config };
    const trimmed = valStr.trim();
    if (trimmed === '') {
      if (key === 'lines') delete nextConfig.lines;
      if (key === 'port') delete nextConfig.port;
      if (key === 'expectedStatus') delete nextConfig.expectedStatus;
    } else {
      const parsed = Number(trimmed);
      const val = Number.isNaN(parsed) ? trimmed : parsed;
      if (key === 'lines') nextConfig.lines = val;
      if (key === 'port') nextConfig.port = val;
      if (key === 'expectedStatus') nextConfig.expectedStatus = val;
    }
    onChange(nextConfig);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`linux-diag-${editorId}`}>Diagnostic Category</Label>
        <div className="mt-1.5">
          <FormSelect
            name={`linux-diag-${editorId}`}
            label="Diagnostic"
            value={diagnostic}
            disabled={readOnly}
            onValueChange={handleDiagnosticChange}
            options={DIAGNOSTICS}
          />
        </div>
        {errors.diagnostic && <p className="mt-1 text-xs text-destructive">{errors.diagnostic}</p>}
      </div>

      {diagnostic === 'dns' && (
        <div>
          <Label htmlFor={`diag-hostname-${editorId}`}>Hostname to Resolve</Label>
          <div className="mt-1.5">
            <Input
              id={`diag-hostname-${editorId}`}
              aria-label="DNS hostname"
              placeholder="e.g. database.internal"
              value={String(config.hostname ?? '')}
              disabled={readOnly}
              onChange={e => onChange({ ...config, hostname: e.target.value })}
              className={errors.hostname ? 'border-destructive' : ''}
            />
          </div>
          {errors.hostname && <p className="mt-1 text-xs text-destructive">{errors.hostname}</p>}
        </div>
      )}

      {diagnostic === 'tcp' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`diag-host-${editorId}`}>Target Host / IP</Label>
            <div className="mt-1.5">
              <Input
                id={`diag-host-${editorId}`}
                aria-label="TCP host"
                placeholder="10.0.0.5 or db.internal"
                value={String(config.host ?? '')}
                disabled={readOnly}
                onChange={e => onChange({ ...config, host: e.target.value })}
                className={errors.host ? 'border-destructive' : ''}
              />
            </div>
            {errors.host && <p className="mt-1 text-xs text-destructive">{errors.host}</p>}
          </div>

          <div>
            <Label htmlFor={`diag-port-${editorId}`}>Port (1–65535)</Label>
            <div className="mt-1.5">
              <Input
                id={`diag-port-${editorId}`}
                aria-label="TCP port"
                type="number"
                min={1}
                max={65535}
                placeholder="5432"
                value={config.port === undefined || config.port === null ? '' : String(config.port)}
                disabled={readOnly}
                onChange={e => handleNumberChange('port', e.target.value)}
                className={errors.port ? 'border-destructive' : ''}
              />
            </div>
            {errors.port && <p className="mt-1 text-xs text-destructive">{errors.port}</p>}
          </div>
        </div>
      )}

      {diagnostic === 'http' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`diag-url-${editorId}`}>Probe URL</Label>
            <div className="mt-1.5">
              <Input
                id={`diag-url-${editorId}`}
                aria-label="Local health URL"
                placeholder="http://127.0.0.1:8080/health"
                value={String(config.url ?? '')}
                disabled={readOnly}
                onChange={e => onChange({ ...config, url: e.target.value })}
                className={errors.url ? 'border-destructive' : ''}
              />
            </div>
            {errors.url && <p className="mt-1 text-xs text-destructive">{errors.url}</p>}
          </div>

          <div>
            <Label htmlFor={`diag-status-${editorId}`}>Expected Status Code</Label>
            <div className="mt-1.5">
              <Input
                id={`diag-status-${editorId}`}
                aria-label="Expected HTTP status"
                type="number"
                min={100}
                max={599}
                placeholder="200"
                value={config.expectedStatus === undefined || config.expectedStatus === null ? '' : String(config.expectedStatus)}
                disabled={readOnly}
                onChange={e => handleNumberChange('expectedStatus', e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {diagnostic === 'journal' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`diag-unit-${editorId}`}>Service Unit</Label>
            <div className="mt-1.5">
              <Input
                id={`diag-unit-${editorId}`}
                aria-label="Journal service unit"
                placeholder="e.g. payments.service"
                value={String(config.unit ?? '')}
                disabled={readOnly}
                onChange={e => onChange({ ...config, unit: e.target.value })}
                className={errors.unit ? 'border-destructive' : ''}
              />
            </div>
            {errors.unit && <p className="mt-1 text-xs text-destructive">{errors.unit}</p>}
          </div>

          <div>
            <Label htmlFor={`diag-lines-${editorId}`}>Lines (1–500)</Label>
            <div className="mt-1.5">
              <Input
                id={`diag-lines-${editorId}`}
                aria-label="Journal lines (maximum 500)"
                type="number"
                min={1}
                max={500}
                placeholder="50"
                value={config.lines === undefined || config.lines === null ? '' : String(config.lines)}
                disabled={readOnly}
                onChange={e => handleNumberChange('lines', e.target.value)}
                className={errors.lines ? 'border-destructive' : ''}
              />
            </div>
            {errors.lines && <p className="mt-1 text-xs text-destructive">{errors.lines}</p>}
          </div>
        </div>
      )}

      {diagnostic === 'process' && (
        <div>
          <Label htmlFor={`diag-pattern-${editorId}`}>Process Search Pattern (pgrep)</Label>
          <div className="mt-1.5">
            <Input
              id={`diag-pattern-${editorId}`}
              aria-label="Process lookup pattern"
              placeholder="e.g. node.*server.js or nginx"
              value={String(config.pattern ?? '')}
              disabled={readOnly}
              onChange={e => onChange({ ...config, pattern: e.target.value })}
              className={errors.pattern ? 'border-destructive' : ''}
            />
          </div>
          {errors.pattern && <p className="mt-1 text-xs text-destructive">{errors.pattern}</p>}
        </div>
      )}

      {diagnostic === 'filesystem' && (
        <div>
          <Label htmlFor={`diag-path-${editorId}`}>Filesystem Path</Label>
          <div className="mt-1.5">
            <Input
              id={`diag-path-${editorId}`}
              aria-label="Filesystem path"
              placeholder="e.g. /var/log or /"
              value={String(config.path ?? '')}
              disabled={readOnly}
              onChange={e => onChange({ ...config, path: e.target.value })}
              className={errors.path ? 'border-destructive' : ''}
            />
          </div>
          {errors.path && <p className="mt-1 text-xs text-destructive">{errors.path}</p>}
        </div>
      )}
    </div>
  );
}
