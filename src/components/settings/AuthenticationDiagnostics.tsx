'use client';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Activity,
  MailWarning,
  Monitor,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Clock,
  Send,
  Layers,
  Info,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import type {
  authenticationDashboard,
  authenticationAlertHistory,
} from '@/lib/auth-control/dashboard';
import {
  diagnosticQuerySchema,
  type DiagnosticQuery,
  type DiagnosticItem,
} from '@/lib/auth-control/diagnostic-contract';
import DiagnosticsPagination from './authentication/DiagnosticsPagination';
import DiagnosticTable from './authentication/DiagnosticTable';
import DiagnosticDetails from './authentication/DiagnosticDetails';
import DiagnosticFilters from './authentication/DiagnosticFilters';
import { useDiagnosticPage } from './authentication/useDiagnosticPage';

type Dashboard = Awaited<ReturnType<typeof authenticationDashboard>>;
type View = DiagnosticQuery['view'];

const views = [
  {
    id: 'sessions',
    label: 'Sign-in & sessions',
    icon: Monitor,
    description:
      'Registered OpsKnight sessions. Search and status filters run before pagination. Token values are never displayed.',
  },
  {
    id: 'deliveries',
    label: 'Security notifications',
    icon: MailWarning,
    description:
      'Investigate retained delivery evidence. Provider acceptance and confirmed delivery are separate states.',
  },
  {
    id: 'audit',
    label: 'Recovery & audit',
    icon: ShieldCheck,
    description:
      'Persisted authentication security events from EmergencyAccessEvent. This is not an exhaustive log of ordinary sign-ins.',
  },
  {
    id: 'replicas',
    label: 'Deployment health',
    icon: Activity,
    description:
      'Compare current web observations with historical reports. A missing observation does not prove an outage.',
  },
] as const;

type Position = { current?: string; previous: Array<string | undefined>; page: number };
const firstPosition = (): Position => ({ current: undefined, previous: [], page: 0 });

export default function AuthenticationDiagnostics({
  data,
  pending,
  onRefresh,
  onRevoke,
  onRetry,
}: {
  data: Pick<
    Dashboard,
    | 'registeredSessions'
    | 'pendingEmailAlerts'
    | 'pendingEmailFanoutJobs'
    | 'deliveredEmailAlertCount'
    | 'acceptedEmailAlertCount'
    | 'cancelledEmailAlertCount'
    | 'failedEmailAlertCount'
    | 'replicas'
    | 'events'
  >;
  pending: boolean;
  onRefresh: () => Promise<void>;
  onRevoke: (sessionId: string) => Promise<void | boolean | 'redirecting'>;
  onRetry: (alertId: string, expectedGeneration: number) => Promise<boolean>;
  onLoadHistory?: (
    status: NonNullable<Parameters<typeof authenticationAlertHistory>[0]>,
    after?: string,
    signal?: AbortSignal
  ) => Promise<Awaited<ReturnType<typeof authenticationAlertHistory>>>;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [view, setView] = useState<View>(
    () => views.find(item => item.id === params?.get('authView'))?.id ?? 'sessions'
  );
  const [queries, setQueries] = useState<Record<View, DiagnosticQuery>>(() => ({
    sessions: diagnosticQuerySchema.parse({ view: 'sessions' }),
    deliveries: diagnosticQuerySchema.parse({ view: 'deliveries', state: 'FAILED' }),
    audit: diagnosticQuerySchema.parse({ view: 'audit' }),
    replicas: diagnosticQuerySchema.parse({ view: 'replicas' }),
  }));
  const [positions, setPositions] = useState<Record<View, Position>>(() => ({
    sessions: firstPosition(),
    deliveries: firstPosition(),
    audit: firstPosition(),
    replicas: firstPosition(),
  }));
  const [selected, setSelected] = useState<DiagnosticItem | null>(null);
  const [refreshError, setRefreshError] = useState('');

  useEffect(() => {
    const sync = () => {
      const next = views.find(
        item => item.id === new URLSearchParams(window.location.search).get('authView')
      )?.id;
      if (next) {
        setView(next);
        setSelected(null);
      }
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  // eslint-disable-next-line security/detect-object-injection -- Key is a closed, server-defined enum.
  const query = queries[view];
  // eslint-disable-next-line security/detect-object-injection -- Key is a closed, server-defined enum.
  const position = positions[view];
  const { page, loading, error, refresh } = useDiagnosticPage({
    ...query,
    after: position.current,
  });
  const current = views.find(item => item.id === view)!;

  const navigate = (next: View) => {
    setView(next);
    setSelected(null);
    const search = new URLSearchParams(window.location.search);
    search.set('authView', next);
    window.history.replaceState(null, '', `${pathname}?${search}`);
  };

  const pagination = (label: string) => (
    <DiagnosticsPagination
      label={label}
      page={position.page}
      count={page?.items.length ?? 0}
      pageSize={query.pageSize}
      hasNext={Boolean(page?.hasMore)}
      hasPrevious={position.previous.length > 0}
      loading={loading}
      onFirst={() => setPositions(previous => ({ ...previous, [view]: firstPosition() }))}
      onNext={() => {
        if (!page?.nextCursor) return;
        setPositions(previous => ({
          ...previous,
          [view]: {
            current: page.nextCursor!,
            previous: [...position.previous, position.current].slice(-100),
            page: position.page + 1,
          },
        }));
      }}
      onPrevious={() =>
        setPositions(previous => ({
          ...previous,
          [view]: {
            current: position.previous.at(-1),
            previous: position.previous.slice(0, -1),
            page: Math.max(0, position.page - 1),
          },
        }))
      }
    />
  );

  return (
    <section aria-labelledby="auth-diagnostics-title" className="min-w-0 space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h2 id="auth-diagnostics-title" className="text-lg font-semibold tracking-tight text-foreground">
              Authentication diagnostics
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              Investigate access, delivery and deployment evidence.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {refreshError && (
            <span role="alert" className="text-xs font-medium text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {refreshError}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={pending || loading}
            onClick={() => {
              setRefreshError('');
              refresh();
              void onRefresh().catch(failure =>
                setRefreshError(
                  failure instanceof Error ? failure.message : 'Summary refresh unavailable.'
                )
              );
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending || loading ? 'animate-spin' : ''}`} />
            Refresh diagnostics
          </Button>
        </div>
      </header>

      {/* Operational Metric Cards */}
      <dl
        className="grid gap-3 grid-cols-2 lg:grid-cols-4"
        aria-label="Current authentication operations"
      >
        {[
          {
            label: 'Failed security emails',
            value: data.failedEmailAlertCount,
            icon: AlertTriangle,
            highlight: data.failedEmailAlertCount > 0,
          },
          {
            label: 'Emails awaiting acceptance',
            value: data.pendingEmailAlerts,
            icon: Clock,
            highlight: false,
          },
          {
            label: 'Awaiting delivery confirmation',
            value: data.acceptedEmailAlertCount,
            icon: Send,
            highlight: false,
          },
          {
            label: 'Fan-out work pending',
            value: data.pendingEmailFanoutJobs,
            icon: Layers,
            highlight: false,
          },
        ].map(item => (
          <div
            key={item.label}
            className={`rounded-xl border p-4 shadow-2xs transition-all ${
              item.highlight
                ? 'border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/20'
                : 'border-border/80 bg-card'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
              <item.icon
                className={`h-4 w-4 shrink-0 ${
                  item.highlight ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground/70'
                }`}
              />
            </div>
            <dd
              className={`mt-2 text-2xl font-bold tracking-tight tabular-nums ${
                item.highlight ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
              }`}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Diagnostic View Tabs */}
      <div
        role="tablist"
        aria-label="Diagnostic views"
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      >
        {views.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            id={`diagnostic-tab-${item.id}`}
            aria-selected={view === item.id}
            aria-controls="diagnostic-view-panel"
            tabIndex={view === item.id ? 0 : -1}
            className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-xs sm:text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${
              view === item.id
                ? 'border-primary bg-primary/10 text-foreground font-semibold shadow-xs ring-1 ring-primary/20'
                : 'border-border/80 bg-card/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            }`}
            onClick={() => navigate(item.id)}
            onKeyDown={event => {
              let next: number | undefined;
              if (event.key === 'ArrowRight') next = (index + 1) % views.length;
              if (event.key === 'ArrowLeft') next = (index + views.length - 1) % views.length;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = views.length - 1;
              if (next !== undefined) {
                event.preventDefault();
                const target = views.find((_, position) => position === next);
                if (target) {
                  navigate(target.id);
                  document.getElementById(`diagnostic-tab-${target.id}`)?.focus();
                }
              }
            }}
          >
            <item.icon
              className={`h-4 w-4 shrink-0 ${view === item.id ? 'text-primary' : 'text-muted-foreground'}`}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Main Diagnostic Panel */}
      <div
        role="tabpanel"
        id="diagnostic-view-panel"
        aria-labelledby={`diagnostic-tab-${view}`}
        aria-busy={loading}
        className="min-w-0 space-y-4 rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs"
      >
        <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="leading-relaxed">{current.description}</p>
        </div>

        <DiagnosticFilters
          key={view}
          query={query}
          onApply={next => {
            setQueries(previous => ({ ...previous, [view]: next }));
            setPositions(previous => ({ ...previous, [view]: firstPosition() }));
          }}
        />

        {pagination('Top diagnostic pagination')}

        {(error || refreshError) && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive space-y-3"
          >
            <div className="flex items-center gap-2 font-semibold text-xs sm:text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <span>{error || refreshError}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/30 hover:bg-destructive/15 text-destructive gap-1.5"
                onClick={refresh}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry this page
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Filters and page navigation are retained. If a cursor expired, choose First page to
              start a new snapshot.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <p role="status">Loading {current.label.toLowerCase()}…</p>
          </div>
        )}

        {!loading && !error && !page?.items.length && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 px-4 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="font-semibold text-sm text-foreground">No matching records</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              Try another time range or clear the filters. No exact lifetime count is required to
              browse history.
            </p>
          </div>
        )}

        {page && page.items.length > 0 && (
          <div className="rounded-xl border border-border/80 bg-background overflow-hidden shadow-2xs">
            <DiagnosticTable items={page.items} onInspect={setSelected} />
          </div>
        )}

        {pagination('Bottom diagnostic pagination')}

        {page && (
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Live pagination started {new Date(page.snapshotAt).toLocaleString()}. Active sessions
            can leave later pages when used, renewed or revoked. This is not an immutable sign-in
            history. Start again to see current activity.
          </p>
        )}
      </div>

      {selected && (
        <DiagnosticDetails
          key={selected.id}
          item={selected}
          pending={pending}
          onClose={() => setSelected(null)}
          onAction={async item => {
            const outcome = item.canRetry
              ? await onRetry(item.id, item.generation!)
              : await onRevoke(item.id);
            // A self-revoked session must not make another protected diagnostics read.
            if (outcome === 'redirecting') return true;
            const success = outcome !== false;
            if (success) refresh();
            return success;
          }}
        />
      )}
    </section>
  );
}
