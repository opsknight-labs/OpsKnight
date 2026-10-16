'use client';

import { useState } from 'react';
import { Check, Copy, Download, ListOrdered, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

export type ExecutionOutputViewerProps = {
  label: string;
  output: string;
  artifactId?: string | null;
  truncatedHint?: boolean;
};

const TOOL_BUTTON =
  'h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground aria-pressed:text-foreground';

export function ExecutionOutputViewer({
  label,
  output,
  artifactId,
  truncatedHint,
}: ExecutionOutputViewerProps) {
  const [wrap, setWrap] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = output.split('\n');
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-3 py-1">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
          <span className="ml-2 text-[11px] font-normal tabular-nums">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TOOL_BUTTON}
            aria-pressed={lineNumbers}
            onClick={() => setLineNumbers(value => !value)}
          >
            <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
            Line numbers
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TOOL_BUTTON}
            aria-pressed={wrap}
            onClick={() => setWrap(value => !value)}
          >
            <WrapText className="h-3.5 w-3.5" aria-hidden="true" />
            Wrap lines
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TOOL_BUTTON}
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(output);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                notify.error('Could not copy output to the clipboard.');
              }
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {artifactId && (
            <Button asChild variant="ghost" size="sm" className={TOOL_BUTTON}>
              <a href={`/api/runbook-artifacts/${encodeURIComponent(artifactId)}`}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Download full output
              </a>
            </Button>
          )}
        </div>
      </div>
      <pre
        tabIndex={0}
        aria-label={label}
        className={cn(
          'max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        )}
      >
        {lineNumbers
          ? lines.map((line, index) => (
              <span key={index} className="table-row">
                <span
                  aria-hidden="true"
                  className="table-cell select-none pr-4 text-right text-muted-foreground/60 tabular-nums"
                >
                  {index + 1}
                </span>
                <span className="table-cell">{line || ' '}</span>
              </span>
            ))
          : output}
      </pre>
      {truncatedHint && !artifactId && (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          Preview is bounded and redacted.
        </p>
      )}
    </div>
  );
}
