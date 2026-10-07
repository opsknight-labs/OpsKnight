import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from './RunbookControls';
import { z } from 'zod';

export const RUNBOOK_PAGE_SIZE = 20;
export function runbookPageQuery(params: Record<string, string | string[] | undefined>) {
  const valueSchema = z.string().max(200);
  const dateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      value =>
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    );
  const entries = Object.entries(params).flatMap(([key, value]) => {
    const idKeys = ['runbook', 'service', 'incident', 'agent', 'owner', 'pool'];
    const parsed = (
      key === 'from' || key === 'to'
        ? dateSchema
        : idKeys.includes(key)
          ? z.string().cuid()
          : valueSchema
    ).safeParse(value);
    return parsed.success ? [[key, parsed.data]] : [];
  });
  const query = Object.fromEntries(entries) as Record<string, string>;
  const candidate = Number(query.page ?? 1);
  return {
    query,
    page: Number.isInteger(candidate) && candidate > 0 && candidate <= 10000 ? candidate : 1,
  };
}

export function RunbookFilters({
  query,
  fields,
  statusOptions = [],
  allStatusLabel = 'All statuses',
}: {
  query: Record<string, string>;
  fields: { name: string; label: string; type?: string }[];
  statusOptions?: { value: string; label: string }[];
  allStatusLabel?: string;
}) {
  const options = statusOptions.some(opt => opt.value === 'all')
    ? statusOptions
    : [{ value: 'all', label: allStatusLabel }, ...statusOptions];

  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      {fields.map(field => (
        <label key={field.name} className="min-w-0 flex-1 text-xs">
          {field.label}
          <Input
            name={field.name}
            aria-label={field.label}
            type={field.type ?? 'text'}
            defaultValue={Object.entries(query).find(([name]) => name === field.name)?.[1] ?? ''}
            maxLength={200}
          />
        </label>
      ))}
      {options.length > 0 && (
        <FormSelect
          name="status"
          label="Status filter"
          defaultValue={query.status || 'all'}
          options={options}
        />
      )}
      <Button type="submit">Apply filters</Button>
    </form>
  );
}

export function RunbookPagination({
  page,
  total,
  query,
}: {
  page: number;
  total: number;
  query: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / RUNBOOK_PAGE_SIZE));
  const href = (target: number) => `?${new URLSearchParams({ ...query, page: String(target) })}`;
  return (
    <nav
      aria-label="Runbook pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span>
        Page {page} of {pages} · {total} results
      </span>
      <div className="flex gap-3">
        {page > 1 && <Link href={href(page - 1)}>Previous page</Link>}
        {page < pages && <Link href={href(page + 1)}>Next page</Link>}
      </div>
    </nav>
  );
}
