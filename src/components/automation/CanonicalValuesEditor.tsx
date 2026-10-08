'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
export function CanonicalValuesEditor({
  values,
  usedValues,
  onChange,
}: {
  values: string[];
  usedValues: Set<string>;
  onChange: (values: string[]) => void;
}) {
  const [next, setNext] = useState('');
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Canonical choices</p>
      <div className="flex flex-wrap gap-2">
        {values.map(value => (
          <span
            key={value}
            className="inline-flex items-center rounded-full border px-2 py-1 text-sm"
          >
            {value}
            <Button
              aria-label={`Remove canonical value ${value}`}
              variant="ghost"
              size="sm"
              disabled={usedValues.has(value)}
              title={
                usedValues.has(value)
                  ? 'Update rules and aliases using this value first'
                  : undefined
              }
              onClick={() => onChange(values.filter(v => v !== value))}
            >
              ×
            </Button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="New canonical choice"
          value={next}
          onChange={event => setNext(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={!next.trim() || values.includes(next.trim()) || values.length >= 200}
          onClick={() => {
            onChange([...values, next.trim()]);
            setNext('');
          }}
        >
          Add choice
        </Button>
      </div>
    </div>
  );
}
