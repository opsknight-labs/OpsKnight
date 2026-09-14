'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/shadcn/button';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/shadcn/alert-dialog';
import {
  AlertCircle,
  CheckCircle2,
  Laptop,
  LogOut,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';
import type { ActiveSession } from '@/lib/active-sessions';

type RegisteredSession = {
  id: string;
  policy: 'STANDARD' | 'TRUSTED_PWA' | 'OIDC';
  state: 'ACTIVE' | 'REVOKED';
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  createdAt: string;
  lastActive: string;
  expiresAt: string | null;
  isCurrent: boolean;
};

type Props = {
  tokenVersion?: number;
  sessions?: ActiveSession[];
};

function formatRelativeTime(isoString: string): string {
  const time = new Date(isoString).getTime();
  if (!Number.isFinite(time)) return 'Recently active';
  const diffMs = Math.max(0, Date.now() - time);
  if (diffMs < 5 * 60 * 1000) return 'Active now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `Active ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  return `Active ${Math.floor(hours / 24)}d ago`;
}

function formatExpiry(value: string | null) {
  if (!value) return 'Session expiry managed by provider';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Session expiry unavailable';
  return `Expires ${date.toLocaleString()}`;
}

function deviceIcon(deviceType: RegisteredSession['deviceType']) {
  if (deviceType === 'mobile') return <Smartphone className="h-5 w-5" />;
  if (deviceType === 'tablet') return <Tablet className="h-5 w-5" />;
  return <Laptop className="h-5 w-5" />;
}

export default function ActiveSessionsSection({ tokenVersion = 1, sessions = [] }: Props) {
  const [registered, setRegistered] = useState<RegisteredSession[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const response = await fetch('/api/user/sessions', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load registered sessions.');
      const payload = (await response.json()) as { sessions?: RegisteredSession[] };
      setRegistered(Array.isArray(payload.sessions) ? payload.sessions : []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load registered sessions.');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const fallback: RegisteredSession[] = useMemo(
    () =>
      sessions.map(session => ({
        id: session.id,
        policy: 'STANDARD',
        state: 'ACTIVE',
        browser: session.browser,
        os: session.os,
        deviceType: session.deviceType,
        createdAt: session.lastActive,
        lastActive: session.lastActive,
        expiresAt: null,
        isCurrent: session.isCurrent,
      })),
    [sessions]
  );
  const displaySessions = registered ?? fallback;

  const revokeSession = (session: RegisteredSession) => {
    setError(null);
    setSuccess(null);
    setRevokingId(session.id);
    startTransition(async () => {
      try {
        const response = await fetch('/api/user/sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          current?: boolean;
        };
        if (!response.ok) throw new Error(payload.error || 'Unable to revoke session.');
        if (payload.current) {
          await signOut({ callbackUrl: '/login?error=SessionExpired' });
          return;
        }
        setSuccess('Session revoked. That browser will be rejected on its next authenticated request.');
        await refresh();
      } catch (revokeError) {
        setError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke session.');
      } finally {
        setRevokingId(null);
      }
    });
  };

  const revokeAll = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/user/sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unable to revoke sessions.');
        setSuccess('All sessions revoked. Redirecting to sign in…');
        await signOut({ callbackUrl: '/login' });
      } catch (revokeError) {
        setError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke sessions.');
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3" aria-live="polite">
        {displaySessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No registered browser sessions were found. This device will register on its next session check.
          </div>
        ) : (
          displaySessions.map(session => {
            const revoked = session.state === 'REVOKED';
            return (
              <div
                key={session.id}
                className={`flex flex-col gap-4 rounded-xl border p-4 transition-all sm:flex-row sm:items-center sm:justify-between ${
                  session.isCurrent && !revoked
                    ? 'border-primary/30 bg-primary/5 shadow-sm'
                    : revoked
                      ? 'border-border/60 bg-muted/30 opacity-75'
                      : 'border-border bg-card'
                }`}
              >
                <div className="flex min-w-0 items-start gap-3.5 sm:items-center">
                  <div className="shrink-0 rounded-xl border border-border bg-muted/70 p-2.5 text-muted-foreground">
                    {deviceIcon(session.deviceType)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold text-foreground">
                        {session.browser} on {session.os}
                      </h4>
                      {session.isCurrent && !revoked ? (
                        <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          This device
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[10px]">
                        {session.policy === 'TRUSTED_PWA'
                          ? 'Trusted PWA'
                          : session.policy === 'OIDC'
                            ? 'Enterprise SSO'
                            : 'Standard'}
                      </Badge>
                      {revoked ? <Badge variant="destructive" className="text-[10px]">Revoked</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatRelativeTime(session.lastActive)} · {formatExpiry(session.expiresAt)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Session {session.id.slice(0, 8)}… · account security token v{tokenVersion}
                    </p>
                  </div>
                </div>

                {!revoked ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant={session.isCurrent ? 'outline' : 'destructive'}
                        size="sm"
                        disabled={isPending && revokingId === session.id}
                        className="shrink-0 gap-2 self-end sm:self-center"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {isPending && revokingId === session.id
                          ? 'Revoking…'
                          : session.isCurrent
                            ? 'Sign out this device'
                            : 'Revoke'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {session.isCurrent ? 'Sign out this device?' : 'Revoke this session?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This revokes only this browser session. Push delivery is managed separately and is not silently disabled by session expiry or revocation.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => revokeSession(session)}>
                          {session.isCurrent ? 'Sign out' : 'Revoke session'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        These are durable JWT session registrations keyed by the encrypted session&apos;s stable ID. Individual revocation is enforced server-side; Push subscriptions have an independent lifecycle.
      </p>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col justify-between gap-3 pt-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
          <span>Use revoke-all as the emergency account-wide kill switch.</span>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isPending} className="shrink-0 gap-2">
              <LogOut className="h-3.5 w-3.5" />
              {isPending && !revokingId ? 'Revoking sessions…' : 'Revoke all sessions'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke every active session?</AlertDialogTitle>
              <AlertDialogDescription>
                This revokes the registered session rows and increments your account token version, invalidating every existing OpsKnight browser session. Push subscriptions remain a separate delivery channel.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={revokeAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Revoke all sessions
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
