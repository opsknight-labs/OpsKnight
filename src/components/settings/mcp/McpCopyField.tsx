'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { copyAuthenticationText } from '@/components/settings/authentication/clipboard';

/** Read-only value with a copy button, used for the MCP endpoint and setup commands. */
export default function McpCopyField({
  value,
  label,
  multiline = false,
}: {
  value: string;
  label: string;
  /** Show the whole value as a code block (for config files) instead of one truncated line. */
  multiline?: boolean;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  const copied = status === 'copied';
  return (
    <div className="min-w-0 space-y-1">
      <div className={`flex min-w-0 gap-2 ${multiline ? 'items-start' : 'items-center'}`}>
        {multiline ? (
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed">
            {value}
          </pre>
        ) : (
          <span
            title={value}
            className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs"
          >
            {value}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            if (timer.current) clearTimeout(timer.current);
            if (await copyAuthenticationText(value)) {
              setStatus('copied');
              timer.current = setTimeout(() => setStatus('idle'), 1500);
            } else setStatus('failed');
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {status === 'failed' && (
        <p role="status" className="text-xs text-destructive">
          Copy failed. Select and copy the value manually.
        </p>
      )}
      {copied && (
        <span role="status" className="sr-only">
          {label} copied.
        </span>
      )}
    </div>
  );
}
