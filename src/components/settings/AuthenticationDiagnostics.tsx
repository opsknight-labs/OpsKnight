'use client';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Activity, MailWarning, Monitor, ShieldCheck } from 'lucide-react';
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
  onRevoke: (sessionId: string) => Promise<void | boolean>;
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="auth-diagnostics-title" className="text-lg font-semibold">
            Authentication diagnostics
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Investigate access, delivery and deployment evidence.
          </p>
        </div>
        <Button
          variant="outline"
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
          Refresh diagnostics
        </Button>
      </header>
      <dl
        className="grid gap-4 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Current authentication operations"
      >
        {[
          ['Failed security emails', data.failedEmailAlertCount],
          ['Emails awaiting acceptance', data.pendingEmailAlerts],
          ['Awaiting delivery confirmation', data.acceptedEmailAlertCount],
          ['Fan-out work pending', data.pendingEmailFanoutJobs],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
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
            className={`flex items-center gap-2 rounded-md border px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.id ? 'border-primary bg-primary/5 font-semibold' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
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
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="diagnostic-view-panel"
        aria-labelledby={`diagnostic-tab-${view}`}
        aria-busy={loading}
        className="min-w-0 space-y-4"
      >
        <p className="text-sm text-muted-foreground">{current.description}</p>
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
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <p>{error ?? refreshError}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              Retry this page
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Filters and page navigation are retained. If a cursor expired, choose First page to
              start a new snapshot.
            </p>
          </div>
        )}
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading {current.label.toLowerCase()}…
          </p>
        )}
        {!loading && !error && !page?.items.length && (
          <div className="py-10 text-center">
            <h3 className="font-medium">No matching records</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Try another time range or clear the filters. No exact lifetime count is required to
              browse history.
            </p>
          </div>
        )}
        {page && <DiagnosticTable items={page.items} onInspect={setSelected} />}
        {pagination('Bottom diagnostic pagination')}
        {page && (
          <p className="text-xs text-muted-foreground">
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
            const success = item.canRetry
              ? await onRetry(item.id, item.generation!)
              : (await onRevoke(item.id)) !== false;
            if (success) refresh();
            return success;
          }}
        />
      )}
    </section>
  );
}
