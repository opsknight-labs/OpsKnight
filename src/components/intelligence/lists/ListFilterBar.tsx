'use client';

import { useRef, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface ListFilterField {
  name: string;
  label: string;
  /** Selected value; an empty string is the "any" option. */
  value: string;
  /** Label of the empty option, e.g. "All services". Omit when a value is always selected. */
  anyLabel?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * Filter bar for the alerts and changes lists. It is a plain GET form, so it works without JavaScript
 * (the Apply button submits it); with JavaScript a change navigates at once. Filters live in the URL,
 * which keeps a filtered view shareable, and changing one always returns to the first page.
 */
export default function ListFilterBar({
  basePath,
  label,
  fields,
  defaults = {},
}: {
  basePath: string;
  label: string;
  fields: readonly ListFilterField[];
  /** Values that are the default for a field and therefore left out of the URL. */
  defaults?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const defaultFor = new Map(Object.entries(defaults));
  const active = fields.some(field => field.value !== (defaultFor.get(field.name) ?? ''));

  const navigate = () => {
    if (!form.current) return;
    const search = new URLSearchParams();
    for (const [key, value] of new FormData(form.current).entries()) {
      if (typeof value !== 'string' || !value || defaultFor.get(key) === value) continue;
      search.set(key, value);
    }
    const query = search.toString();
    startTransition(() => router.push(query ? `${basePath}?${query}` : basePath));
  };

  return (
    <form
      ref={form}
      method="get"
      action={basePath}
      role="search"
      aria-label={label}
      aria-busy={pending}
      onSubmit={event => {
        event.preventDefault();
        navigate();
      }}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3"
    >
      {fields.map(field => {
        const id = `list-filter-${field.name}`;
        return (
          <div key={field.name} className="min-w-[9rem] flex-1 space-y-1 sm:max-w-[14rem]">
            <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
              {field.label}
            </label>
            <select
              id={id}
              name={field.name}
              defaultValue={field.value}
              key={field.value}
              onChange={navigate}
              className="h-11 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
            >
              {field.anyLabel !== undefined && <option value="">{field.anyLabel}</option>}
              {field.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className={cn(
            'inline-flex h-11 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9',
            pending && 'opacity-70'
          )}
        >
          Apply
        </button>
        {active && (
          <Link
            href={basePath}
            className="inline-flex h-11 items-center rounded-md px-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
          >
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
