'use client';
import { useId, useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { AuthoringFieldset, Hint, InlineError, NativeSelect } from './authoring/primitives';
export function AliasEditor({
  aliases,
  canonicalValues,
  onChange,
}: {
  aliases: Record<string, string>;
  canonicalValues?: string[];
  onChange: (aliases: Record<string, string>) => void;
}) {
  const id = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const entries = Object.entries(aliases);
  const newAlias = from.trim();
  const duplicate = !!newAlias && Object.hasOwn(aliases, newAlias);
  const canAdd = !!newAlias && !!to.trim() && !duplicate;
  return (
    <AuthoringFieldset
      legend="Aliases → canonical values"
      description="Map raw values your providers send (e.g. “prd”) to the value rules compare against."
    >
      {entries.length === 0 ? (
        <Hint>No aliases yet.</Hint>
      ) : (
        <ul className="space-y-2" aria-label="Aliases">
          {entries.map(([alias, canonical]) => (
            <li
              key={alias}
              className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_2.5rem]"
            >
              <span className="min-w-0 break-all rounded-md bg-muted px-2.5 py-2 font-mono text-xs">
                {alias}
              </span>
              <ArrowRight
                className="hidden h-4 w-4 text-muted-foreground sm:block"
                aria-hidden="true"
              />
              {canonicalValues ? (
                <NativeSelect
                  aria-label={`Canonical value for ${alias}`}
                  value={canonical}
                  onChange={event => onChange({ ...aliases, [alias]: event.target.value })}
                >
                  {!canonicalValues.includes(canonical) && (
                    <option value={canonical}>{canonical} (not a choice)</option>
                  )}
                  {canonicalValues.map(value => (
                    <option key={value}>{value}</option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  aria-label={`Canonical value for ${alias}`}
                  value={canonical}
                  onChange={event => onChange({ ...aliases, [alias]: event.target.value })}
                />
              )}
              <Button
                size="icon"
                variant="ghost"
                className="justify-self-end text-muted-foreground hover:text-destructive"
                aria-label={`Remove alias ${alias}`}
                onClick={() =>
                  onChange(
                    Object.fromEntries(Object.entries(aliases).filter(([key]) => key !== alias))
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)_auto]"
        onSubmit={event => {
          event.preventDefault();
          if (!canAdd) return;
          onChange({ ...aliases, [newAlias]: to.trim() });
          setFrom('');
          setTo('');
        }}
      >
        <div className="min-w-0 space-y-1">
          <Input
            aria-label="New alias"
            placeholder="prd"
            aria-invalid={duplicate || undefined}
            aria-describedby={duplicate ? `${id}-error` : undefined}
            value={from}
            onChange={event => setFrom(event.target.value)}
          />
          {duplicate && (
            <InlineError id={`${id}-error`}>“{newAlias}” is already mapped.</InlineError>
          )}
        </div>
        <ArrowRight
          className="mt-3 hidden h-4 w-4 text-muted-foreground sm:block"
          aria-hidden="true"
        />
        {canonicalValues ? (
          <NativeSelect
            aria-label="New canonical value"
            value={to}
            onChange={event => setTo(event.target.value)}
          >
            <option value="">Choose canonical value…</option>
            {canonicalValues.map(value => (
              <option key={value}>{value}</option>
            ))}
          </NativeSelect>
        ) : (
          <Input
            aria-label="New canonical value"
            placeholder="production"
            value={to}
            onChange={event => setTo(event.target.value)}
          />
        )}
        <Button type="submit" variant="outline" disabled={!canAdd}>
          <Plus aria-hidden="true" />
          Add alias
        </Button>
      </form>
    </AuthoringFieldset>
  );
}
