'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
export function AliasEditor({
  aliases,
  canonicalValues,
  onChange,
}: {
  aliases: Record<string, string>;
  canonicalValues?: string[];
  onChange: (aliases: Record<string, string>) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Aliases → canonical values</h4>
      {Object.entries(aliases).map(([alias, canonical]) => (
        <div key={alias} className="flex flex-wrap gap-2 items-center">
          <span className="rounded-md bg-muted px-2 py-1 text-sm">{alias}</span>
          <span aria-hidden="true">→</span>
          {canonicalValues ? (
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              aria-label={`Canonical value for ${alias}`}
              value={canonical}
              onChange={event => onChange({ ...aliases, [alias]: event.target.value })}
            >
              {canonicalValues.map(value => (
                <option key={value}>{value}</option>
              ))}
            </select>
          ) : (
            <Input
              aria-label={`Canonical value for ${alias}`}
              value={canonical}
              onChange={event => onChange({ ...aliases, [alias]: event.target.value })}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove alias ${alias}`}
            onClick={() =>
              onChange(Object.fromEntries(Object.entries(aliases).filter(([key]) => key !== alias)))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="New alias"
          placeholder="prd"
          value={from}
          onChange={event => setFrom(event.target.value)}
          className="flex-1 min-w-24"
        />
        {canonicalValues ? (
          <select
            aria-label="New canonical value"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={to}
            onChange={event => setTo(event.target.value)}
          >
            <option value="">Choose canonical value…</option>
            {canonicalValues.map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        ) : (
          <Input
            aria-label="New canonical value"
            placeholder="production"
            value={to}
            onChange={event => setTo(event.target.value)}
            className="flex-1 min-w-24"
          />
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!from.trim() || !to.trim() || Object.hasOwn(aliases, from.trim())}
          onClick={() => {
            onChange({ ...aliases, [from.trim()]: to.trim() });
            setFrom('');
            setTo('');
          }}
        >
          Add alias
        </Button>
      </div>
    </div>
  );
}
