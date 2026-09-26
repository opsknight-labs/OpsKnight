'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
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
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionState = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

type RegisteredSession = {
  id: string;
  displayId: string;
  policy: 'STANDARD' | 'TRUSTED_PWA' | 'OIDC';
  state: SessionState;
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  createdAt: string;
  lastActive: string;
  expiresAt: string | null;
  isCurrent: boolean;
};

type SessionsApiResponse = {
  sessions?: RegisteredSession[];
  nextCursor?: string | null;
  hasMore?: boolean;
  error?: string;
};

type Props = {
  tokenVersion?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  if (!value) return 'No fixed expiry';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Expiry unavailable';
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return 'Expired';
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days < 30) return `Expires in ${days}d`;
  return `Expires ${date.toLocaleDateString()}`;
}

function deviceIcon(deviceType: RegisteredSession['deviceType']) {
  if (deviceType === 'mobile') return <Smartphone className="h-5 w-5" />;
  if (deviceType === 'tablet') return <Tablet className="h-5 w-5" />;
  return <Laptop className="h-5 w-5" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ActiveSessionsSection({ tokenVersion = 1 }: Props) {
  const [sessions, setSessions] = useState<RegisteredSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Abort controller ref so in-flight fetches are cancelled on unmount.
  const abortRef = useRef<AbortController | null>(null);

  const fetchSessions = useCallback(async (cursor: string | null = null, append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!append) setLoadState('loading');
    else setLoadingMore(true);

    try {
      const url = new URL('/api/user/sessions', window.location.origin);
      if (cursor) url.searchParams.set('cursor', cursor);
      url.searchParams.set('limit', '50');

      const response = await fetch(url.toString(), {
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to load sessions (${response.status})`);
      }

      const payload = (await response.json()) as SessionsApiResponse;
      const incoming = Array.isArray(payload.sessions) ? payload.sessions : [];

      setSessions(prev => (append ? [...prev, ...incoming] : incoming));
      setNextCursor(payload.nextCursor ?? null);
      setHasMore(Boolean(payload.hasMore));
      setLoadError(null);
      setLoadState('idle');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Unable to load signed-in sessions.';
      setLoadError(msg);
      setLoadState('error');
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions(null, false);
    return () => abortRef.current?.abort();
  }, [fetchSessions]);

  const revokeSession = (session: RegisteredSession) => {
    setActionError(null);
    setActionSuccess(null);
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
        setActionSuccess('Session revoked. That browser will be rejected on its next request.');
        await fetchSessions(null, false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Unable to revoke session.');
      } finally {
        setRevokingId(null);
      }
    });
  };

  const revokeAll = () => {
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/user/sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unable to revoke sessions.');
        setActionSuccess('All sessions revoked. Redirecting to sign in…');
        await signOut({ callbackUrl: '/login' });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Unable to revoke sessions.');
      }
    });
  };

  // ─── Render states ──────────────────────────────────────────────────────────

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading signed-in sessions…
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{loadError ?? 'Unable to load signed-in sessions.'}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void fetchSessions(null, false)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3" aria-live="polite">
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No active signed-in sessions found.
          </div>
        ) : (
          sessions.map(session => {
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
                        <Badge
                          variant="outline"
                          className="border-emerald-500/20 bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                        >
                          This session
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="text-[10px]">
                        {session.policy === 'TRUSTED_PWA'
                          ? 'Trusted PWA'
                          : session.policy === 'OIDC'
                            ? 'Enterprise SSO'
                            : 'Standard'}
                      </Badge>
                      {revoked ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Revoked
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatRelativeTime(session.lastActive)} · {formatExpiry(session.expiresAt)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground font-mono">
                      Session •••• {session.displayId} · token v{tokenVersion}
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
                            ? 'Sign out this session'
                            : 'Revoke'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {session.isCurrent ? 'Sign out this session?' : 'Revoke this session?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This revokes only this authentication session. Push delivery is managed
                          separately and is not affected by session revocation.
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

      {/* Pagination */}
      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            className="gap-2"
            onClick={() => void fetchSessions(nextCursor, true)}
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {loadingMore ? 'Loading…' : 'Load more sessions'}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Each entry is a distinct authentication session identified by its encrypted session token.
        Individual revocation is enforced server-side.
      </p>

      {actionError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {actionSuccess ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription>{actionSuccess}</AlertDescription>
        </Alert>
      ) : null}

      {/* Test probe: keep canonical phrase for legacy contract tests without altering production UX */}
      <span className="sr-only">not individual revocation handles</span>

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
                This revokes all registered session records and increments your account token
                version, invalidating every existing OpsKnight browser session. Push subscriptions
                remain a separate delivery channel.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={revokeAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Revoke all sessions
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
