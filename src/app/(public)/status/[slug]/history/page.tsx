import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatusPageHistoryView } from '@/components/status-page/StatusPageIncidentView';
import {
  MONTH_PATTERN,
  getOpenStatusSnapshot,
  incidentsForMonth,
  shiftMonth,
} from '@/lib/status-pages/public-access';

export const metadata: Metadata = { title: 'Incident history' };

/** Month-paged incident history from the published snapshot (retention window applies). */
export default async function StatusHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { slug } = await params;
  const { month: requested } = await searchParams;
  const snapshot = await getOpenStatusSnapshot(slug);
  if (!snapshot) notFound();
  const now = new Date();
  const current = now.toISOString().slice(0, 7);
  const earliest = new Date(now.getTime() - snapshot.historyDays * 86_400_000)
    .toISOString()
    .slice(0, 7);
  const month = requested && MONTH_PATTERN.test(requested) ? requested : current;
  if (month > current || month < earliest) notFound();
  return (
    <StatusPageHistoryView
      snapshot={snapshot}
      incidents={incidentsForMonth(snapshot.incidents, month)}
      month={month}
      basePath={`/status/${encodeURIComponent(slug)}`}
      prevMonth={month > earliest ? shiftMonth(month, -1) : null}
      nextMonth={month < current ? shiftMonth(month, 1) : null}
    />
  );
}
