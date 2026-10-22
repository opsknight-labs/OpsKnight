'use client';
import { memo, useId } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { cn } from '@/lib/utils';
import type { Field, Scalar } from '@/lib/automation/contract';
import { InlineError, NativeSelect } from './authoring/primitives';

export function parseAuthoringScalar(raw: string, type?: Field['type']): Scalar {
  if (type === 'NUMBER') return raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  if (type === 'BOOLEAN') return raw === 'true' ? true : raw === 'false' ? false : raw;
  return raw;
}
function TypedValueInputComponent({
  type,
  canonicalValues = [],
  value,
  list = false,
  label,
  disabled,
  compact = false,
  onChange,
}: {
  type?: Field['type'];
  canonicalValues?: string[];
  value: Scalar | Scalar[] | undefined;
  list?: boolean;
  label: string;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: Scalar | Scalar[]) => void;
}) {
  const errorId = useId();
  const values = Array.isArray(value) ? value : [value];
  const invalid =
    (type === 'NUMBER' || type === 'BOOLEAN') &&
    values.some(item => typeof item !== (type === 'NUMBER' ? 'number' : 'boolean'));
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  const staleChoice =
    type === 'ENUM' && !list && text !== '' && !canonicalValues.includes(text) ? text : null;
  return (
    <div className="min-w-0 w-full space-y-1">
      {type === 'ENUM' ? (
        list ? (
          <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {canonicalValues.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Add canonical choices to this field first.
              </span>
            )}
            {canonicalValues.map(item => {
              const checked = Array.isArray(value) && value.includes(item);
              return (
                <label
                  key={item}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                    compact
                      ? 'min-h-7 rounded-md px-2.5 py-0.5 text-xs'
                      : 'min-h-10 rounded-full px-3 text-sm sm:min-h-8',
                    checked
                      ? 'border-primary/50 bg-primary/10 text-foreground font-medium'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted',
                    disabled && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    disabled={disabled}
                    checked={checked}
                    onChange={event => {
                      const selected = Array.isArray(value) ? value : [];
                      onChange(
                        event.target.checked
                          ? [...selected, item]
                          : selected.filter(v => v !== item)
                      );
                    }}
                  />
                  {item}
                </label>
              );
            })}
          </div>
        ) : (
          <NativeSelect
            aria-label={label}
            aria-invalid={staleChoice !== null || undefined}
            aria-describedby={staleChoice !== null ? errorId : undefined}
            disabled={disabled}
            value={text}
            className={compact ? 'h-7.5 text-xs px-2' : undefined}
            onChange={event => onChange(event.target.value)}
          >
            <option value="">Choose canonical value…</option>
            {canonicalValues.map(item => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            {staleChoice !== null && (
              <option value={staleChoice}>{staleChoice} (not a choice)</option>
            )}
          </NativeSelect>
        )
      ) : type === 'BOOLEAN' && !list ? (
        <NativeSelect
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          disabled={disabled}
          value={text}
          className={compact ? 'h-7.5 text-xs px-2' : undefined}
          onChange={event => onChange(parseAuthoringScalar(event.target.value, type))}
        >
          <option value="">Choose true or false…</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </NativeSelect>
      ) : (
        <Input
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className={cn(
            'aria-[invalid=true]:border-destructive',
            compact ? 'h-7.5 text-xs' : undefined
          )}
          inputMode={type === 'NUMBER' ? 'decimal' : undefined}
          placeholder={list ? 'Comma-separated values' : undefined}
          disabled={disabled}
          value={text}
          onChange={event =>
            onChange(
              list
                ? event.target.value.split(',').map(item => parseAuthoringScalar(item.trim(), type))
                : parseAuthoringScalar(event.target.value, type)
            )
          }
        />
      )}
      {invalid && (
        <div role="alert">
          <InlineError id={errorId}>
            {type === 'NUMBER'
              ? 'Enter a finite number; blank is not zero.'
              : 'Choose true or false explicitly.'}
          </InlineError>
        </div>
      )}
      {staleChoice !== null && (
        <InlineError id={errorId}>
          “{staleChoice}” is no longer a canonical choice for this field.
        </InlineError>
      )}
    </div>
  );
}
export const TypedValueInput = memo(TypedValueInputComponent);
