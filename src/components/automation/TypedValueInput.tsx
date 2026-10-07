'use client';
import { Input } from '@/components/ui/shadcn/input';
import type { Field, Scalar } from '@/lib/automation/contract';

export function parseAuthoringScalar(raw: string, type?: Field['type']): Scalar {
  if (type === 'NUMBER') return raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  if (type === 'BOOLEAN') return raw === 'true' ? true : raw === 'false' ? false : raw;
  return raw;
}
export function TypedValueInput({
  type,
  value,
  list = false,
  label,
  disabled,
  onChange,
}: {
  type?: Field['type'];
  value: Scalar | Scalar[] | undefined;
  list?: boolean;
  label: string;
  disabled?: boolean;
  onChange: (value: Scalar | Scalar[]) => void;
}) {
  const values = Array.isArray(value) ? value : [value];
  const invalid =
    (type === 'NUMBER' || type === 'BOOLEAN') &&
    values.some(item => typeof item !== (type === 'NUMBER' ? 'number' : 'boolean'));
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  return (
    <div className="min-w-0 w-full sm:w-48 space-y-1">
      {type === 'BOOLEAN' && !list ? (
        <select
          aria-label={label}
          aria-invalid={invalid}
          disabled={disabled}
          value={text}
          onChange={event => onChange(parseAuthoringScalar(event.target.value, type))}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Choose true or false…</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      ) : (
        <Input
          aria-label={label}
          aria-invalid={invalid}
          inputMode={type === 'NUMBER' ? 'decimal' : undefined}
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
        <p role="alert" className="text-xs text-destructive">
          {type === 'NUMBER'
            ? 'Enter a finite number; blank is not zero.'
            : 'Choose true or false explicitly.'}
        </p>
      )}
    </div>
  );
}
