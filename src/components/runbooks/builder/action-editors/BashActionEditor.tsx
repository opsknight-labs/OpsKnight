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
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">Bash Script Execution Safety & Agent Allowlist</p>
            <p className="text-muted-foreground">
              Bash actions are classified as <strong>NON_IDEMPOTENT</strong> and require human approval before execution. Scripts execute via <code className="font-mono text-[11px]">bash --noprofile --norc -c</code> under the Agent host context. Multi-line scripts can include <code className="font-mono text-[11px]">set -euo pipefail</code>.
            </p>
            <p className="text-muted-foreground">
              <strong>Allowlist matching:</strong> The executed command must exactly match an entry in the Agent&apos;s local <code className="font-mono text-[11px]">bashCommandPatterns</code> allowlist. To parameterize scripts without breaking static allowlist matching, use typed inputs as environment variables: <code className="font-mono text-[11px]">&quot;$OPSKNIGHT_INPUT_&lt;KEY&gt;&quot;</code>.
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`bash-command-${editorId}`}>Script / Shell Command</Label>
          <span className="text-xs text-muted-foreground">Executed via bash --noprofile --norc -c</span>
        </div>
        <div className="mt-1.5">
          <Textarea
            id={`bash-command-${editorId}`}
            aria-label="Exact allowlisted command"
            placeholder={`#!/usr/bin/env bash\n# Include set -euo pipefail for fail-fast error handling\nset -euo pipefail\nsystemctl restart "$OPSKNIGHT_INPUT_SERVICE"\n`}
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
          <span className="font-medium text-muted-foreground">Insert Input Environment Variable: </span>
          <p className="text-[11px] text-muted-foreground mt-0.5 mb-1.5">
            Typed inputs are exported as <code className="font-mono">OPSKNIGHT_INPUT_&lt;KEY&gt;</code>. Use environment variables in scripts to keep allowlisted commands static.
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {inputs.map(input => {
              const envVar = `"$OPSKNIGHT_INPUT_${input.key.toUpperCase()}"`;
              return (
                <button
                  key={input.key}
                  type="button"
                  disabled={readOnly}
                  onClick={() => updateCommand(command ? `${command} ${envVar}` : envVar)}
                  className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                  title={`Click to append ${envVar}`}
                >
                  {envVar}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
