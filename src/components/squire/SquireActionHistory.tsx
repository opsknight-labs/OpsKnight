'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type {
  ActionHistoryPage,
  ActionHistoryRow,
} from '@/lib/intelligence/squire/actions/history';

const STATUS: Record<ActionHistoryRow['status'], { label: string; tone: ToneKey }> = {
  SUCCEEDED: { label: 'Succeeded', tone: 'ok' },
  FAILED: { label: 'Failed', tone: 'critical' },
  UNKNOWN: { label: 'Unknown', tone: 'elevated' },
  RESERVED: { label: 'In progress', tone: 'info' },
  RUNNING: { label: 'In progress', tone: 'info' },
};

export default function SquireActionHistory({
  initial,
  status,
  loadMore,
}: {
  initial: ActionHistoryPage;
  status?: string;
  loadMore: (input: {
    scope?: string;
    status?: string;
    cursor?: string;
  }) => Promise<ActionHistoryPage | null>;
}) {
  const [rows, setRows] = useState(initial.rows);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const showWho = initial.scope === 'everyone';
  const { userTimeZone } = useTimezone();

  const more = () =>
    startTransition(async () => {
      try {
        const next = await loadMore({ scope: initial.scope, status, cursor: cursor ?? undefined });
        if (!next) throw new Error('unavailable');
        setRows(current => [...current, ...next.rows]);
        setCursor(next.nextCursor);
        setError(false);
      } catch {
        setError(true);
      }
    });

  const filtered = status && status in STATUS ? STATUS[status as ActionHistoryRow['status']] : null;
  if (rows.length === 0 && !cursor)
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground md:px-6">
        {filtered ? `No ${filtered.label.toLowerCase()} actions.` : 'No actions yet.'}
      </p>
    );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Actions confirmed from Squire, newest first</caption>
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium md:px-6">
                When
              </th>
              {showWho && (
                <th scope="col" className="px-4 py-2 font-medium">
                  Who
                </th>
              )}
              <th scope="col" className="px-4 py-2 font-medium">
                Action
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2 font-medium md:pr-6">
                Outcome
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row => (
              <tr key={row.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground md:px-6">
                  <time dateTime={row.at}>
                    {formatDateTime(row.at, userTimeZone, { includeTimeZone: true })}
                  </time>
                </td>
                {showWho && <td className="px-4 py-3">{row.who}</td>}
                <td className="px-4 py-3 font-medium">
                  {row.href ? (
                    <Link href={row.href} className="underline-offset-2 hover:underline">
                      {row.action}
                    </Link>
                  ) : (
                    row.action
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
                      toneClasses(STATUS[row.status].tone).soft
                    )}
                  >
                    {STATUS[row.status].label}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground md:pr-6">{row.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-3 md:px-6">
          <Button variant="secondary" size="sm" onClick={more} isLoading={pending}>
            Load more
          </Button>
          {error && (
            <p role="alert" className={cn('text-sm', toneClasses('critical').text)}>
              Older actions could not be loaded. Try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
