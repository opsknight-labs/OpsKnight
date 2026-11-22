'use client';

import { useRef, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import FilterBar, {
  FilterChip,
  FilterField,
  type FilterChipTone,
} from '@/components/patterns/FilterBar';
import { Button } from '@/components/ui/shadcn/button';
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

/** A field offered as quick-filter chips instead of a select; its value travels in a hidden input. */
export interface ListChipField {
  name: string;
  label: string;
  value: string;
  anyLabel: string;
  options: ReadonlyArray<{ value: string; label: string; tone?: FilterChipTone; icon?: ReactNode }>;
}

const controlClass =
  'h-11 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground transition-colors duration-150 hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9';

/**
 * Filter card for the alerts and changes lists, in the console's FilterBar look. It is a plain GET form,
 * so it works without JavaScript (Enter in the search box or the Apply button submits it); with
 * JavaScript a change navigates at once. Filters live in the URL, which keeps a filtered view shareable,
 * and changing one always returns to the first page.
 */
export default function ListFilterBar({
  basePath,
  label,
  description,
  fields,
  chips,
  search,
  defaults = {},
}: {
  basePath: string;
  label: string;
  description?: string;
  fields: readonly ListFilterField[];
  chips?: ListChipField;
  /** Free-text search, sent as `q`. */
  search?: { value: string; placeholder: string; label: string };
  /** Values that are the default for a field and therefore left out of the URL. */
  defaults?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const chipInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const defaultFor = new Map(Object.entries(defaults));
  const active =
    fields.some(field => field.value !== (defaultFor.get(field.name) ?? '')) ||
    Boolean(chips?.value) ||
    Boolean(search?.value);

  const navigate = () => {
    if (!form.current) return;
    const query = new URLSearchParams();
    for (const [key, value] of new FormData(form.current).entries()) {
      if (typeof value !== 'string' || !value.trim() || defaultFor.get(key) === value) continue;
      query.set(key, value.trim());
    }
    const text = query.toString();
    startTransition(() => router.push(text ? `${basePath}?${text}` : basePath));
  };

  const pickChip = (value: string) => {
    if (chipInput.current) chipInput.current.value = value;
    navigate();
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
    >
      {chips && (
        <input
          ref={chipInput}
          type="hidden"
          name={chips.name}
          defaultValue={chips.value}
          key={chips.value}
        />
      )}
      <FilterBar
        title={label}
        description={description}
        chips={
          chips && (
            <>
              <span className="sr-only">{chips.label}:</span>
              <FilterChip active={chips.value === ''} onClick={() => pickChip('')}>
                {chips.anyLabel}
              </FilterChip>
              {chips.options.map(option => (
                <FilterChip
                  key={option.value}
                  active={chips.value === option.value}
                  tone={option.tone}
                  icon={option.icon}
                  onClick={() => pickChip(chips.value === option.value ? '' : option.value)}
                >
                  {option.label}
                </FilterChip>
              ))}
            </>
          )
        }
        filters={
          <>
            {search && (
              <div className="relative col-span-2 w-full sm:w-72">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  name="q"
                  defaultValue={search.value}
                  key={search.value}
                  aria-label={search.label}
                  placeholder={search.placeholder}
                  maxLength={100}
                  className={cn(controlClass, 'pl-9')}
                />
              </div>
            )}
            {fields.map(field => {
              const id = `list-filter-${field.name}`;
              return (
                <FilterField key={field.name} label={field.label} htmlFor={id} className="sm:w-44">
                  <select
                    id={id}
                    name={field.name}
                    defaultValue={field.value}
                    key={field.value}
                    onChange={navigate}
                    className={controlClass}
                  >
                    {field.anyLabel !== undefined && <option value="">{field.anyLabel}</option>}
                    {field.options.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FilterField>
              );
            })}
          </>
        }
        actions={
          <>
            {active && (
              <Button asChild variant="ghost" size="sm" className="h-11 gap-1 px-2.5 sm:h-9">
                <Link href={basePath}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear filters
                </Link>
              </Button>
            )}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className={cn('h-11 sm:h-9', pending && 'opacity-70')}
            >
              Apply
            </Button>
          </>
        }
      />
    </form>
  );
}
