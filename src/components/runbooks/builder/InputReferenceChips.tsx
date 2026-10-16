'use client';

import { Braces } from 'lucide-react';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import { cn } from '@/lib/utils';

export function inputReference(key: string) {
  return `\${{ inputs.${key} }}`;
}

/** Insertable `${{ inputs.key }}` chips for the runbook's defined inputs. */
export default function InputReferenceChips({
  inputs,
  onInsert,
  readOnly = false,
  current,
  label = 'Use an input',
  className,
}: {
  inputs: RunbookInputInput[];
  onInsert: (reference: string) => void;
  readOnly?: boolean;
  current?: string;
  label?: string;
  className?: string;
}) {
  if (readOnly) return null;
  if (inputs.length === 0) {
    return (
      <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <Braces className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Tip: reference runbook inputs with{' '}
          <code className="rounded bg-muted px-1 font-mono text-[11px]">
            {inputReference('key')}
          </code>
          . Define them in the Inputs tab.
        </span>
      </p>
    );
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Braces className="h-3.5 w-3.5" aria-hidden="true" />
        {label}:
      </span>
      {inputs.map(input => {
        const reference = inputReference(input.key);
        const active = current === reference;
        return (
          <button
            key={input.key}
            type="button"
            title={input.label ? `Insert ${input.label}` : `Insert ${reference}`}
            aria-pressed={current === undefined ? undefined : active}
            onClick={() => onInsert(reference)}
            className={cn(
              'rounded-full px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary/10 text-primary ring-primary/30'
                : 'bg-background text-foreground ring-border hover:bg-muted'
            )}
          >
            {reference}
          </button>
        );
      })}
    </div>
  );
}
