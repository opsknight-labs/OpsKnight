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
                className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background py-0.5 pl-3 pr-0.5 text-sm"
              >
                <span className="break-all">{value}</span>
                <Button
                  aria-label={`Remove canonical value ${value}`}
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full text-muted-foreground hover:text-destructive sm:h-7 sm:w-7"
                  disabled={used}
                  title={used ? 'Update rules and aliases using this value first' : undefined}
                  onClick={() => onChange(values.filter(v => v !== value))}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {anyUsed && (
        <Hint>
          Choices used by rules or aliases can’t be removed until those references change.
        </Hint>
      )}
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={event => {
          event.preventDefault();
          add();
        }}
      >
        <div className="min-w-0 flex-1 basis-40 space-y-1">
          <Input
            aria-label="New canonical choice"
            placeholder="production"
            aria-invalid={duplicate || undefined}
            aria-describedby={duplicate ? `${id}-error` : undefined}
            value={next}
            onChange={event => setNext(event.target.value)}
          />
          {duplicate && (
            <InlineError id={`${id}-error`}>“{trimmed}” is already a choice.</InlineError>
          )}
        </div>
        <Button type="submit" variant="outline" disabled={!canAdd}>
          <Plus aria-hidden="true" />
          Add choice
        </Button>
      </form>
    </AuthoringFieldset>
  );
}
