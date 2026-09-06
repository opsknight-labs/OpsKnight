import { getLogBuffer } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';

export const dynamic = 'force-dynamic';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export default async function SystemLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; search?: string; component?: string }>;
}) {
  const params = await searchParams;
  const session = await getServerSession(await getAuthOptions());

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Only admins can view logs
  const user = session.user as { email: string; role?: string };
  if (user.role !== 'ADMIN') {
    redirect('/');
  }

  // Get all logs from buffer (newest first)
  const allLogs = getLogBuffer(500).reverse();

  // Apply filters
  let filteredLogs = allLogs;

  if (params.level) {
    filteredLogs = filteredLogs.filter(log => log.level === params.level);
  }

  if (params.component) {
    filteredLogs = filteredLogs.filter(log =>
      log.component?.toLowerCase().includes(params.component!.toLowerCase())
    );
  }

  if (params.search) {
    const searchLower = params.search.toLowerCase();
    filteredLogs = filteredLogs.filter(
      log =>
        log.message.toLowerCase().includes(searchLower) ||
        log.component?.toLowerCase().includes(searchLower) ||
        log.error?.message.toLowerCase().includes(searchLower)
    );
  }

  // Calculate stats
  const stats = {
    total: allLogs.length,
    errors: allLogs.filter(l => l.level === 'error').length,
    warnings: allLogs.filter(l => l.level === 'warn').length,
    info: allLogs.filter(l => l.level === 'info').length,
    debug: allLogs.filter(l => l.level === 'debug').length,
  };

  const levelConfig: Record<
    LogLevel,
    { variant: 'danger' | 'warning' | 'info' | 'neutral'; border: string; emoji: string }
  > = {
    error: { variant: 'danger', border: 'border-l-red-600', emoji: '❌' },
    warn: { variant: 'warning', border: 'border-l-yellow-600', emoji: '⚠️' },
    info: { variant: 'info', border: 'border-l-blue-600', emoji: 'ℹ️' },
    debug: { variant: 'neutral', border: 'border-l-gray-600', emoji: '🔍' },
  };

  return (
    <main className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight mb-1">System Logs</h1>
        <p className="text-sm text-muted-foreground">
          Real-time application logging and error tracking
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <Link href="/system-logs" className="glass-panel p-4 hover:shadow-md transition-shadow">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total</div>
          <div className="text-2xl font-extrabold tracking-tight">{stats.total}</div>
        </Link>
        <Link
          href="/system-logs?level=error"
          className="glass-panel p-4 hover:shadow-md transition-shadow border-l-4 border-l-red-500"
        >
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Errors</div>
          <div className="text-2xl font-extrabold tracking-tight text-red-600">{stats.errors}</div>
        </Link>
        <Link
          href="/system-logs?level=warn"
          className="glass-panel p-4 hover:shadow-md transition-shadow border-l-4 border-l-yellow-500"
        >
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Warnings</div>
          <div className="text-2xl font-extrabold tracking-tight text-yellow-600">
            {stats.warnings}
          </div>
        </Link>
        <Link
          href="/system-logs?level=info"
          className="glass-panel p-4 hover:shadow-md transition-shadow border-l-4 border-l-blue-500"
        >
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Info</div>
          <div className="text-2xl font-extrabold tracking-tight text-blue-600">{stats.info}</div>
        </Link>
        <Link
          href="/system-logs?level=debug"
          className="glass-panel p-4 hover:shadow-md transition-shadow border-l-4 border-l-gray-500"
        >
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Debug</div>
          <div className="text-2xl font-extrabold tracking-tight text-gray-600">{stats.debug}</div>
        </Link>
      </div>

      {/* Filters */}
      <div className="glass-panel p-4 mb-4">
        <form method="GET" className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[250px]">
            <input
              type="text"
              name="search"
              placeholder="🔍 Search messages, components, errors..."
              defaultValue={params.search || ''}
              className="w-full px-3 py-2 border border-border rounded-md text-sm"
            />
          </div>

          <select
            name="level"
            defaultValue={params.level || ''}
            className="px-3 py-2 border border-border rounded-md bg-white text-sm"
            onChange={e => e.currentTarget.form?.submit()}
          >
            <option value="">All Levels</option>
            <option value="error">❌ Errors</option>
            <option value="warn">⚠️ Warnings</option>
            <option value="info">ℹ️ Info</option>
            <option value="debug">🔍 Debug</option>
          </select>

          <input
            type="text"
            name="component"
            placeholder="Component"
            defaultValue={params.component || ''}
            className="px-3 py-2 border border-border rounded-md text-sm w-32"
          />

          <button
            type="submit"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
          >
            Filter
          </button>

          {(params.level || params.search || params.component) && (
            <Link
              href="/system-logs"
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="glass-panel p-3 mb-2 flex items-center justify-between bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {filteredLogs.length} {filteredLogs.length === 1 ? 'Log' : 'Logs'}
        </span>
        <span className="text-xs text-muted-foreground">Last 500 entries • Newest first</span>
      </div>

      {/* Logs List */}
      <div className="flex flex-col gap-1.5">
        {filteredLogs.length === 0 ? (
          <div className="glass-panel p-16 text-center">
            <div className="text-5xl mb-4 opacity-20">📋</div>
            <p className="text-muted-foreground">
              {allLogs.length === 0 ? 'No logs captured yet' : 'No logs match your current filters'}
            </p>
            {allLogs.length > 0 && (
              <Link
                href="/system-logs"
                className="text-sm text-primary hover:underline mt-2 inline-block"
              >
                Clear filters to see all logs
              </Link>
            )}
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const config = levelConfig[log.level as LogLevel];
            const timestamp = new Date(log.timestamp);

            return (
              <details
                key={`${log.timestamp}-${index}`}
                className={`glass-panel p-3 cursor-pointer border-l-2 ${config.border} hover:shadow-sm transition-shadow`}
              >
                <summary className="flex items-start gap-3 list-none">
                  <span className="text-base mt-0.5 flex-shrink-0">{config.emoji}</span>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <Badge variant={config.variant} size="xs" className="uppercase">
                        {log.level}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        {timestamp.toLocaleTimeString('en-US', {
                          timeZone: 'UTC',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        })}
                      </span>
                      {log.component && (
                        <Badge variant="outline" size="xs" className="uppercase">
                          {log.component}
                        </Badge>
                      )}
                      {log.duration !== undefined && (
                        <Badge variant="outline" size="xs" className="font-mono">
                          {log.duration}ms
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm font-medium leading-snug truncate">{log.message}</div>
                    {log.error && (
                      <div className="mt-1 text-xs text-red-600 truncate">{log.error.message}</div>
                    )}
                  </div>
                </summary>

                <div className="mt-3 pt-3 border-t border-border/50 text-xs space-y-3">
                  {log.context && Object.keys(log.context).length > 0 && (
                    <div>
                      <div className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                        Context
                      </div>
                      <pre className="bg-muted/50 p-2.5 rounded-md overflow-auto text-[11px] leading-relaxed">
                        {JSON.stringify(log.context, null, 2)}
                      </pre>
                    </div>
                  )}

                  {log.error?.stack && (
                    <div>
                      <div className="font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                        Stack Trace
                      </div>
                      <pre className="bg-red-50 p-2.5 rounded-md overflow-auto text-[10px] text-red-700 font-mono leading-relaxed border border-red-200">
                        {log.error.stack}
                      </pre>
                    </div>
                  )}

                  {(log.requestId || log.userId) && (
                    <div className="flex gap-4 text-[11px] text-muted-foreground pt-2">
                      {log.requestId && (
                        <span>
                          Request: <code className="bg-muted px-1 rounded">{log.requestId}</code>
                        </span>
                      )}
                      {log.userId && (
                        <span>
                          User: <code className="bg-muted px-1 rounded">{log.userId}</code>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </details>
            );
          })
        )}
      </div>

      <div className="mt-4 p-3 bg-muted/30 rounded-md text-xs text-muted-foreground text-center">
        💡 Logs are stored in memory (last 500 entries) and cleared on restart
      </div>
    </main>
  );
}
