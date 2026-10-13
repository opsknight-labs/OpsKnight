'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import type { authenticationDashboard } from '@/lib/auth-control/dashboard';

type Dashboard = Awaited<ReturnType<typeof authenticationDashboard>>;
export default function AuthenticationDiagnostics({
  data,
  pending,
  onRefresh,
  onRevoke,
}: {
  data: Pick<Dashboard, 'registeredSessions' | 'pendingEmailAlerts' | 'replicas' | 'events'>;
  pending: boolean;
  onRefresh: () => Promise<void>;
  onRevoke: (sessionId: string) => Promise<void>;
}) {
  const [sessionMethod, setSessionMethod] = useState('all');
  return (
    <section
      id="authentication-4"
      className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5"
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
            <li key={session.id} className="rounded-md border p-3 space-y-1">
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
      <p className="text-sm">
        {data.pendingEmailAlerts} security email deliveries pending. In-app alerts are retained
        independently. Discovery health and real administrator login are distinct checks.
      </p>
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
