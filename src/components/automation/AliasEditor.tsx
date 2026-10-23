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
      compact
      legend="Aliases → canonical values"
      description="Map raw values your providers send (e.g. “prd”) to the value rules compare against."
    >
      {entries.length === 0 ? (
        <Hint>No aliases yet.</Hint>
      ) : (
        <ul
          className="divide-y divide-border/60 rounded-lg border border-border/70 bg-background/60 text-xs overflow-hidden"
          aria-label="Aliases"
        >
          {entries.map(([alias, canonical]) => (
            <li
              key={alias}
              className="flex items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-muted/20"
            >
              <span className="min-w-[4rem] text-center font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/70 border border-border/50 text-foreground shrink-0 break-all">
                {alias}
              </span>
              <ArrowRight
                className="h-3 w-3 text-muted-foreground shrink-0 hidden sm:block"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                {canonicalValues ? (
                  <NativeSelect
                    aria-label={`Canonical value for ${alias}`}
                    className="h-7 text-xs bg-background py-0.5"
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
                    className="h-7 text-xs font-mono bg-background"
                    value={canonical}
                    onChange={event => onChange({ ...aliases, [alias]: event.target.value })}
                  />
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
                aria-label={`Remove alias ${alias}`}
                onClick={() =>
                  onChange(
                    Object.fromEntries(Object.entries(aliases).filter(([key]) => key !== alias))
                  )
                }
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 pt-0.5"
        onSubmit={event => {
          event.preventDefault();
          if (!canAdd) return;
          onChange({ ...aliases, [newAlias]: to.trim() });
          setFrom('');
          setTo('');
        }}
      >
        <div className="min-w-0 flex-1 space-y-1 basis-36">
          <Input
            aria-label="New alias"
            placeholder="Raw alias (e.g. prd)"
            aria-invalid={duplicate || undefined}
            aria-describedby={duplicate ? `${id}-error` : undefined}
            className="h-7.5 text-xs font-mono bg-background"
            value={from}
            onChange={event => setFrom(event.target.value)}
          />
          {duplicate && (
            <InlineError id={`${id}-error`}>“{newAlias}” is already mapped.</InlineError>
          )}
        </div>
        <ArrowRight
          className="hidden sm:block h-3.5 w-3.5 text-muted-foreground shrink-0"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 basis-44">
          {canonicalValues ? (
            <NativeSelect
              aria-label="New canonical value"
              className="h-7.5 text-xs bg-background py-0.5"
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
              className="h-7.5 text-xs font-mono bg-background"
              value={to}
              onChange={event => setTo(event.target.value)}
            />
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
          Add alias
        </Button>
      </form>
    </AuthoringFieldset>
  );
}
