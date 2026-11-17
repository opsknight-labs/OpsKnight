import { getLogBuffer } from '@/lib/logger';
import { Terminal, XCircle, AlertTriangle, Info, Bug } from 'lucide-react';
import { PageHeader } from '@/components/patterns';
import { requirePageAccess } from '@/lib/access/server';
import { parsePageParam, calculatePaginationBounds } from '@/lib/pagination-parser';
import SystemLogsView, { type SystemLogRow } from './SystemLogsView';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

function stringifyContext(context: unknown): string | null {
  if (!context || typeof context !== 'object' || Object.keys(context).length === 0) return null;
  try {
    return JSON.stringify(context, null, 2);
  } catch {
    return '[Context could not be serialized]';
  }
}

export default async function SystemLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; search?: string; component?: string; page?: string }>;
}) {
  // Admin-only; checked against the database role (not the session token) by the page rule.
  await requirePageAccess('/system-logs');
  const params = await searchParams;

  // Newest first.
  const allLogs = (getLogBuffer(500) || []).reverse();

  let filteredLogs = allLogs;
  if (params.level) {
    filteredLogs = filteredLogs.filter(log => log.level === params.level);
  }
  if (params.component) {
    const compFilter = params.component.toLowerCase();
    filteredLogs = filteredLogs.filter(log =>
      Boolean(log.component && log.component.toLowerCase().includes(compFilter))
    );
  }
  if (params.search) {
    const searchLower = params.search.toLowerCase();
    filteredLogs = filteredLogs.filter(
      log =>
        Boolean(log.message && String(log.message).toLowerCase().includes(searchLower)) ||
        Boolean(log.component && String(log.component).toLowerCase().includes(searchLower)) ||
        Boolean(log.error?.message && String(log.error.message).toLowerCase().includes(searchLower))
    );
  }

  const pagination = calculatePaginationBounds({
    totalItems: filteredLogs.length,
    page: parsePageParam(params.page),
    pageSize: PAGE_SIZE,
  });

  const rows: SystemLogRow[] = filteredLogs
    .slice(pagination.skip, pagination.skip + pagination.take)
    .map((log, index) => ({
      key: `${log.timestamp}-${pagination.skip + index}`,
      level: String(log.level || 'info'),
      message: log.message ? String(log.message) : '',
      timestamp: log.timestamp ?? '',
      component: log.component ?? null,
      duration: typeof log.duration === 'number' ? log.duration : null,
      requestId: log.requestId ?? null,
      userId: log.userId ?? null,
      errorMessage: log.error?.message ?? null,
      errorStack: log.error?.stack ?? null,
      context: stringifyContext(log.context),
    }));

  const counts = {
    error: allLogs.filter(l => l.level === 'error').length,
    warn: allLogs.filter(l => l.level === 'warn').length,
    info: allLogs.filter(l => l.level === 'info').length,
    debug: allLogs.filter(l => l.level === 'debug').length,
  };

  const levelHref = (level: string) =>
    params.level === level ? '/system-logs' : `/system-logs?level=${level}`;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="System Logs"
        icon={Terminal}
        description="Application logs from this server: errors, warnings and diagnostics. Kept in memory (last 500 entries) and cleared when the server restarts."
        stats={[
          {
            label: 'Errors',
            value: counts.error,
            icon: <XCircle className="h-3.5 w-3.5" aria-hidden="true" />,
            href: levelHref('error'),
            active: params.level === 'error',
            tooltip: 'Show only errors',
          },
          {
            label: 'Warnings',
            value: counts.warn,
            icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
            href: levelHref('warn'),
            active: params.level === 'warn',
            tooltip: 'Show only warnings',
          },
          {
            label: 'Info',
            value: counts.info,
            icon: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
            href: levelHref('info'),
            active: params.level === 'info',
            tooltip: 'Show only info',
          },
          {
            label: 'Debug',
            value: counts.debug,
            icon: <Bug className="h-3.5 w-3.5" aria-hidden="true" />,
            href: levelHref('debug'),
            active: params.level === 'debug',
            tooltip: 'Show only debug',
          },
        ]}
      />

      <SystemLogsView
        rows={rows}
        totalCaptured={allLogs.length}
        totalMatching={filteredLogs.length}
        page={pagination.page}
        pageSize={PAGE_SIZE}
        currentLevel={params.level ?? ''}
        currentSearch={params.search ?? ''}
        currentComponent={params.component ?? ''}
      />
    </div>
  );
}
