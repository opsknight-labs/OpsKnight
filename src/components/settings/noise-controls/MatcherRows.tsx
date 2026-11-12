'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  emptyMatcher,
  MATCHER_FIELD_LABELS,
  MATCHER_OP_LABELS,
  type MatcherDraft,
} from '@/lib/intelligence/noise-controls/builders';
import {
  MATCHER_FIELDS,
  MATCHER_OPS,
  PREPAGING_LIMITS,
} from '@/lib/intelligence/noise-controls/contract';
import { fieldClass, touchButton } from './shared';

/**
 * Condition rows shared by the suppression and orchestration builders. Every row must match (AND).
 * Each control is labelled; a row's error is tied to its value input.
 */
export default function MatcherRows({
  rows,
  onChange,
  errors = [],
  legend = 'Conditions (all must match)',
  max = PREPAGING_LIMITS.maxMatchers,
}: {
  rows: MatcherDraft[];
  onChange: (rows: MatcherDraft[]) => void;
  errors?: Array<string | null>;
  legend?: string;
  max?: number;
}) {
  const id = useId();
  const update = (index: number, patch: Partial<MatcherDraft>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <ol className="space-y-2">
        {rows.map((row, index) => {
          const base = `${id}-${index}`;
          const error = errors.at(index);
          const position = `condition ${index + 1}`;
          return (
            <li
              key={index}
              className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end"
            >
              <div className="space-y-1">
                <label htmlFor={`${base}-field`} className="text-xs font-medium">
                  Field
                </label>
                <select
                  id={`${base}-field`}
                  value={row.field}
                  onChange={event => update(index, { field: event.target.value })}
                  className={fieldClass}
                >
                  {MATCHER_FIELDS.map(field => (
                    <option key={field} value={field}>
                      {MATCHER_FIELD_LABELS.get(field)}
                    </option>
                  ))}
                </select>
              </div>
              {row.field === 'label' ? (
                <div className="space-y-1">
                  <label htmlFor={`${base}-key`} className="text-xs font-medium">
                    Label key
                  </label>
                  <input
                    id={`${base}-key`}
                    value={row.key}
                    onChange={event => update(index, { key: event.target.value })}
                    className={fieldClass}
                    placeholder="env"
                  />
                </div>
              ) : (
                <div aria-hidden="true" className="hidden sm:block" />
              )}
              <div className="space-y-1">
                <label htmlFor={`${base}-op`} className="text-xs font-medium">
                  Operator
                </label>
                <select
                  id={`${base}-op`}
                  value={row.op}
                  onChange={event => update(index, { op: event.target.value })}
                  className={fieldClass}
                >
                  {MATCHER_OPS.map(op => (
                    <option key={op} value={op}>
                      {MATCHER_OP_LABELS.get(op)}
                    </option>
                  ))}
                </select>
              </div>
              {row.op !== 'exists' ? (
                <div className="space-y-1">
                  <label htmlFor={`${base}-value`} className="text-xs font-medium">
                    Value
                  </label>
                  <input
                    id={`${base}-value`}
                    value={row.value}
                    onChange={event => update(index, { value: event.target.value })}
                    className={fieldClass}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${base}-error` : undefined}
                  />
                </div>
              ) : (
                <div aria-hidden="true" className="hidden sm:block" />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={touchButton}
                disabled={rows.length <= 1}
                aria-label={`Remove ${position}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
              {error && (
                <p id={`${base}-error`} className="text-xs text-destructive sm:col-span-5">
                  {position[0].toUpperCase() + position.slice(1)}: {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={touchButton}
        disabled={rows.length >= max}
        onClick={() => onChange([...rows, emptyMatcher()])}
      >
        Add condition
      </Button>
    </fieldset>
  );
}
