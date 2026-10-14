'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import type {
  authenticationDashboard,
  authenticationAlertHistory,
} from '@/lib/auth-control/dashboard';

type DeliveryHistory = Awaited<ReturnType<typeof authenticationAlertHistory>>;
type DeliveryStatus = NonNullable<Parameters<typeof authenticationAlertHistory>[0]>;
type Dashboard = Awaited<ReturnType<typeof authenticationDashboard>>;
export default function AuthenticationDiagnostics({
  data,
  pending,
  onRefresh,
  onRevoke,
  onRetry,
  onLoadHistory,
}: {
  data: Pick<
    Dashboard,
    | 'registeredSessions'
    | 'pendingEmailAlerts'
    | 'pendingEmailFanoutJobs'
    | 'deliveredEmailAlertCount'
    | 'cancelledEmailAlertCount'
    | 'failedEmailAlertCount'
    | 'replicas'
    | 'events'
  >;
  pending: boolean;
  onRefresh: () => Promise<void>;
  onRevoke: (sessionId: string) => Promise<void>;
  onRetry: (alertId: string, expectedGeneration: number) => Promise<boolean>;
  onLoadHistory: (
    status: DeliveryStatus,
    after?: string,
    signal?: AbortSignal
  ) => Promise<DeliveryHistory>;
}) {
  const [sessionMethod, setSessionMethod] = useState('all');
  const [retryId, setRetryId] = useState<string | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('failed');
  const [history, setHistory] = useState<DeliveryHistory>({ alerts: [], nextCursor: null });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const historyRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    historyRequest.current?.abort();
    historyRequest.current = controller;
    setHistoryLoading(true);
    setHistoryError('');
    setHistory({ alerts: [], nextCursor: null });
    void onLoadHistory(deliveryStatus, undefined, controller.signal)
      .then(page => {
        if (!controller.signal.aborted) setHistory(page);
      })
      .catch(error => {
        if (!controller.signal.aborted)
          setHistoryError(error instanceof Error ? error.message : 'Delivery history unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => historyRequest.current?.abort();
  }, [deliveryStatus, data, onLoadHistory]);
  const loadMore = async () => {
    if (!history.nextCursor || historyLoading) return;
    const controller = new AbortController();
    historyRequest.current?.abort();
    historyRequest.current = controller;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const page = await onLoadHistory(deliveryStatus, history.nextCursor, controller.signal);
      if (!controller.signal.aborted)
        setHistory(previous => ({
          alerts: [...previous.alerts, ...page.alerts],
          nextCursor: page.nextCursor,
        }));
    } catch (error) {
      if (!controller.signal.aborted)
        setHistoryError(error instanceof Error ? error.message : 'Delivery history unavailable.');
    } finally {
      if (!controller.signal.aborted) setHistoryLoading(false);
    }
  };
  return (
    <section
      id="authentication-4"
      className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5"
      aria-labelledby="auth-diagnostics-title"
    >
      <h2 id="auth-diagnostics-title" className="text-lg font-semibold">
        Diagnostics
      </h2>
      <label className="block text-sm">
        <span>Registered session method (100 most recent)</span>
        <select
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={sessionMethod}
          onChange={event => setSessionMethod(event.target.value)}
        >
          <option value="all">All</option>
          <option value="credentials">Password</option>
          <option value="oidc">OIDC</option>
        </select>
      </label>
      <ul className="space-y-3 text-sm">
        {data.registeredSessions
          .filter(session => sessionMethod === 'all' || session.method === sessionMethod)
          .map(session => (
            <li
              key={session.id}
              className="rounded-md border p-3 space-y-1 [overflow-wrap:anywhere]"
            >
              <p>
                {session.email} — {session.method} — {session.state}
              </p>
              <p>
                Expires: {session.expiresAt ?? 'unknown'}; issuing policy:{' '}
                {session.issuedUnderPolicyVersion ?? 'legacy unknown'}
              </p>
              <Button
                variant="outline"
                disabled={pending || session.state !== 'ACTIVE'}
                onClick={() => void onRevoke(session.id)}
              >
                Revoke session
              </Button>
            </li>
          ))}
      </ul>
      <dl
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        aria-label="Security email processing"
      >
        {[
          ['Fan-out jobs pending', data.pendingEmailFanoutJobs],
          ['Materialized emails pending', data.pendingEmailAlerts],
          ['Failed deliveries', data.failedEmailAlertCount],
          ['Completed deliveries', data.deliveredEmailAlertCount],
          ['Cancelled deliveries', data.cancelledEmailAlertCount],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-border p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Fan-out jobs have recipients still being materialized; they are separate from the email
        counts. Delivery counts cover retained records. In-app security evidence is independent.
      </p>
      <div className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-medium">Security email delivery history</h3>
        <p className="text-sm text-muted-foreground">
          Review your notification provider before retrying failed deliveries. History loads in
          pages of 25 records.
        </p>
        <label className="block text-sm">
          Delivery status
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            value={deliveryStatus}
            onChange={event => {
              setRetryId(null);
              setDeliveryStatus(event.target.value as DeliveryStatus);
            }}
          >
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="delivered">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </label>
        {historyError && (
          <p role="alert" className="text-sm text-destructive">
            {historyError}
          </p>
        )}
        {historyLoading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading delivery history…
          </p>
        )}
        {!historyLoading && !historyError && !history.alerts.length && (
          <p className="text-sm text-muted-foreground">No deliveries match this status.</p>
        )}
        <ul className="space-y-3">
          {history.alerts.map(alert => (
            <li key={alert.id} className="space-y-2 border-t border-border pt-3 text-sm">
              <p className="break-words">{alert.title}</p>
              <p className="text-muted-foreground">
                {alert.state} · {alert.attempts} attempts ·{' '}
                <time dateTime={alert.completedAt ?? alert.createdAt}>
                  {new Date(alert.completedAt ?? alert.createdAt).toLocaleString()}
                </time>
              </p>
              {alert.lastError && (
                <p className="break-words text-muted-foreground">{alert.lastError}</p>
              )}
              {alert.state === 'FAILED' &&
                (retryId === alert.id ? (
                  <div className="space-y-2">
                    <p role="status">
                      Retry creates a new email attempt. If prior delivery was uncertain, the
                      recipient may receive a duplicate.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={pending}
                        onClick={() =>
                          void onRetry(alert.id, alert.deliveryGeneration).then(success => {
                            if (success) setRetryId(null);
                          })
                        }
                      >
                        Confirm email retry
                      </Button>
                      <Button variant="outline" disabled={pending} onClick={() => setRetryId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" disabled={pending} onClick={() => setRetryId(alert.id)}>
                    Retry email
                  </Button>
                ))}
            </li>
          ))}
        </ul>
        {history.nextCursor && (
          <Button
            variant="outline"
            disabled={pending || historyLoading}
            onClick={() => void loadMore()}
          >
            Load more deliveries
          </Button>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        {data.replicas.map(replica => (
          <li key={replica.id}>
            {replica.id}:{' '}
            {replica.differs
              ? 'conflicting legacy deployment settings — reconcile before enforcement'
              : 'legacy import consistent'}
          </li>
        ))}
      </ul>
      <ul className="divide-y divide-border text-sm">
        {data.events.map(event => (
          <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="break-all">
              {event.eventType} — {event.outcome}
            </span>
            <time>{event.createdAt}</time>
          </li>
        ))}
      </ul>
      <Button variant="outline" disabled={pending} onClick={() => void onRefresh()}>
        Refresh diagnostics
      </Button>
    </section>
  );
}
