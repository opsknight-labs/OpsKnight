'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Choice<T extends string = string> = {
  value: T;
  title: string;
  /** One plain sentence on what picking it does. */
  body?: ReactNode;
  disabled?: boolean;
};

/**
 * A short, mutually exclusive choice shown as cards, for options a person has to understand before picking
 * (a mode, a provider). Seven or fewer; a longer list wants SearchableSelect. A native radio group underneath,
 * so it submits with a plain form, is one tab stop with arrow keys, and is announced as a group.
 */
export default function ChoiceCards<T extends string>({
  name,
  legend,
  choices,
  value,
  defaultValue,
  onChange,
  columns = 3,
  className,
}: {
  name: string;
  legend: ReactNode;
  choices: ReadonlyArray<Choice<T>>;
  /** Controlled value; leave undefined for an uncontrolled group starting at `defaultValue`. */
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  columns?: 2 | 3;
  className?: string;
}) {
  const [internal, setInternal] = useState<T | undefined>(defaultValue ?? choices[0]?.value);
  const current = value ?? internal;
  return (
    <fieldset className={cn('space-y-2', className)}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className={cn('grid gap-3', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {choices.map(choice => (
          <label
            key={choice.value}
            className={cn(
              'flex items-start gap-3 rounded-lg border border-border bg-card p-4 has-[input:checked]:border-primary has-[input:checked]:bg-primary/5 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring',
              choice.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={current === choice.value}
              disabled={choice.disabled}
              onChange={() => {
                setInternal(choice.value);
                onChange?.(choice.value);
              }}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold">{choice.title}</span>
              {choice.body && (
                <span className="block text-sm font-normal text-muted-foreground">
                  {choice.body}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
