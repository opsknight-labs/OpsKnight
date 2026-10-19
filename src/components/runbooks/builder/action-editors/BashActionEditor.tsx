'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { AlertTriangle, Braces, ChevronRight } from 'lucide-react';
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
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <p className="flex items-start gap-2 font-medium text-foreground">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          Bash always needs approval, and the command must exactly match the Agent’s allowlist.
        </p>
        <details className="group mt-1.5 pl-5 text-muted-foreground">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight
              className="h-3 w-3 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            How this works
          </summary>
          <div className="mt-1.5 space-y-1.5 leading-relaxed">
            <p>
              Bash steps are classified as <strong>NON_IDEMPOTENT</strong>. Scripts run via{' '}
              <code className="font-mono text-[11px]">bash --noprofile --norc -c</code> on the Agent
              host. Multi-line scripts can include{' '}
              <code className="font-mono text-[11px]">set -euo pipefail</code>.
            </p>
            <p>
              <strong>Allowlist matching:</strong> the executed command must exactly match an entry
              in the Agent&apos;s local{' '}
              <code className="font-mono text-[11px]">bashCommandPatterns</code>. To parameterise
              without breaking matching, read typed inputs from environment variables like{' '}
              <code className="font-mono text-[11px]">
                &quot;$OPSKNIGHT_INPUT_&lt;KEY&gt;&quot;
              </code>
              .
            </p>
          </div>
        </details>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`bash-command-${editorId}`} className="text-xs">
            Command
          </Label>
          <span className="font-mono text-[11px] text-muted-foreground">
            bash --noprofile --norc -c
          </span>
        </div>
        <Textarea
          id={`bash-command-${editorId}`}
          aria-label="Exact allowlisted command"
          placeholder={`set -euo pipefail\nsystemctl restart "$OPSKNIGHT_INPUT_SERVICE"\n`}
          value={command}
          disabled={readOnly}
          onChange={e => updateCommand(e.target.value)}
          className={`min-h-36 font-mono text-xs ${errors.command ? 'border-destructive' : ''}`}
          spellCheck={false}
        />
        {errors.command && <p className="text-xs text-destructive">{errors.command}</p>}
      </div>

      {inputs.length > 0 && !readOnly && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Braces className="h-3.5 w-3.5" aria-hidden="true" />
            Append an input as an environment variable:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {inputs.map(input => {
              const envVar = `"$OPSKNIGHT_INPUT_${input.key.toUpperCase()}"`;
              return (
                <button
                  key={input.key}
                  type="button"
                  onClick={() => updateCommand(command ? `${command} ${envVar}` : envVar)}
                  className="rounded-full bg-background px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset ring-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={input.label ? `Append ${input.label}` : `Append ${envVar}`}
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
