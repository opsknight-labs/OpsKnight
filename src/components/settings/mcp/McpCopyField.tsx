'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

/** Read-only value with a copy button, used for the MCP endpoint. */
export default function McpCopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
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
          await navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
