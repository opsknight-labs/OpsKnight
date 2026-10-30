'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { copyAuthenticationText } from '@/components/settings/authentication/clipboard';

/** Read-only value with a copy button, used for the MCP endpoint. */
export default function McpCopyField({ value, label }: { value: string; label: string }) {
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
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
          {value}
        </span>
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
