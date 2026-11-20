import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { z } from 'zod/v3';

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
      className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-muted-foreground"
    >
      <span className="tabular-nums">
        Page {page} of {pages} · {total} results
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs">
              <Link href={href(page - 1)} rel="prev">
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Previous page
              </Link>
            </Button>
          ) : null}
          {page < pages ? (
            <Button asChild variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs">
              <Link href={href(page + 1)} rel="next">
                Next page
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      )}
    </nav>
  );
}
