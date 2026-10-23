'use client';
import { useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { AuthoringFieldset, Hint, InlineError, LimitCounter } from './authoring/primitives';

const MAX_CHOICES = 200;

export function CanonicalValuesEditor({
  values,
  usedValues,
  onChange,
}: {
  values: string[];
  usedValues: Set<string>;
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  const [next, setNext] = useState('');
  const trimmed = next.trim();
  const duplicate = !!trimmed && values.includes(trimmed);
  const canAdd = !!trimmed && !duplicate && values.length < MAX_CHOICES;
  const anyUsed = values.some(value => usedValues.has(value));
  const add = () => {
    if (!canAdd) return;
    onChange([...values, trimmed]);
    setNext('');
  };
  return (
    <AuthoringFieldset
      compact
      legend="Canonical choices"
      aside={<LimitCounter count={values.length} limit={MAX_CHOICES} noun="choices" />}
    >
      {values.length === 0 ? (
        <Hint>No choices yet. Add the values rules should compare against.</Hint>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Canonical choices">
          {values.map(value => {
            const used = usedValues.has(value);
            return (
              <li
                key={value}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/80 py-0.5 pl-2 pr-1 text-xs font-mono shadow-2xs hover:border-border transition-colors"
              >
                <span className="break-all font-medium text-foreground">{value}</span>
                <Button
                  aria-label={`Remove canonical value ${value}`}
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 rounded p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  disabled={used}
                  title={used ? 'Update rules and aliases using this value first' : undefined}
                  onClick={() => onChange(values.filter(v => v !== value))}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {anyUsed && (
        <Hint className="text-[11px] leading-tight">
          Choices used by rules or aliases can’t be removed until those references change.
        </Hint>
      )}
      <form
        className="flex items-center gap-1.5 pt-0.5"
        onSubmit={event => {
          event.preventDefault();
          add();
        }}
      >
        <div className="min-w-0 flex-1 max-w-xs space-y-1">
          <Input
            aria-label="New canonical choice"
            placeholder="e.g. production"
            aria-invalid={duplicate || undefined}
            aria-describedby={duplicate ? `${id}-error` : undefined}
            className="h-7.5 text-xs font-mono bg-background"
            value={next}
            onChange={event => setNext(event.target.value)}
          />
          {duplicate && (
            <InlineError id={`${id}-error`}>“{trimmed}” is already a choice.</InlineError>
          )}
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-7.5 text-xs px-2.5 gap-1 shrink-0 bg-background hover:bg-muted font-medium"
          disabled={!canAdd}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add choice
        </Button>
      </form>
    </AuthoringFieldset>
  );
}
