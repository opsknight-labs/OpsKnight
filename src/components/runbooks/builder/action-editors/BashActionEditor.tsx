'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { AlertTriangle } from 'lucide-react';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

interface BashActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs: RunbookInputInput[];
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

export default function BashActionEditor({
  config,
  errors = {},
  inputs,
  editorId = 'bash',
  readOnly = false,
  onChange,
}: BashActionEditorProps) {
  const command = String(config.command ?? '');

  const updateCommand = (val: string) => {
    onChange({ ...config, command: val });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning-foreground">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Bash Script Execution Safety</p>
            <p className="text-muted-foreground">
              Bash actions are classified as <strong>NON_IDEMPOTENT</strong> and always require explicit human approval before execution. Scripts execute under a restricted user context on the designated Agent host. Never hardcode plaintext credentials; use scoped secret references.
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`bash-command-${editorId}`}>Script / Shell Command</Label>
          <span className="text-xs text-muted-foreground">Executed via bash -euo pipefail</span>
        </div>
        <div className="mt-1.5">
          <Textarea
            id={`bash-command-${editorId}`}
            aria-label="Exact allowlisted command"
            placeholder={`#!/usr/bin/env bash\n# Your remediation script here\nsystemctl restart my-app\n`}
            value={command}
            disabled={readOnly}
            onChange={e => updateCommand(e.target.value)}
            className={`font-mono text-xs min-h-36 ${errors.command ? 'border-destructive' : ''}`}
            spellCheck={false}
          />
        </div>
        {errors.command && <p className="mt-1 text-xs text-destructive">{errors.command}</p>}
      </div>

      {inputs.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-2.5 text-xs">
          <span className="font-medium text-muted-foreground">Insert Input Reference: </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {inputs.map(input => (
              <button
                key={input.key}
                type="button"
                disabled={readOnly}
                onClick={() => updateCommand(`${command}\${{ inputs.${input.key} }}`)}
                className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                title={`Click to append \${{ inputs.${input.key} }}`}
              >
                {`\${{ inputs.${input.key} }}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
