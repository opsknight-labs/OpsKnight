'use client';

import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';

/**
 * A compact "3 scopes" chip that opens the full list. A popover (not a hover tooltip) so it also
 * works with touch and keyboard.
 */
export default function McpScopeSummary({
  scopes,
  context,
}: {
  /** Each scope with its plain-language label, computed on the server. */
  scopes: { scope: string; label: string }[];
  /** Names what the scopes belong to, for the accessible name, e.g. "Claude for Jane Doe". */
  context: string;
}) {
  if (scopes.length === 0) return <span className="text-xs text-muted-foreground">No scopes</span>;
  const noun = scopes.length === 1 ? 'scope' : 'scopes';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-icon-button
          aria-label={`${scopes.length} ${noun} for ${context}. Show list`}
          className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted/40 px-2 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {scopes.length} {noun}
          <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="w-72 max-w-[calc(100vw-1.5rem)] p-3"
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Allowed scopes
        </p>
        <ul className="space-y-1.5">
          {scopes.map(({ scope, label }) => (
            <li key={scope} className="flex flex-col gap-0.5 p-0">
              <span className="text-xs text-foreground">{label}</span>
              <code className="font-mono text-[10px] text-muted-foreground">{scope}</code>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
