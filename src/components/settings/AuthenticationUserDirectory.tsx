'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Search, Users, Loader2, AlertCircle, ExternalLink, MoreHorizontal } from 'lucide-react';
import OidcLinkingApprovalButton from '@/components/users/OidcLinkingApprovalButton';
import type { OidcLinkingState } from '@/lib/oidc-linking-approval';

type User = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  roleSource: string;
  issuers: string[];
  linkingState?: OidcLinkingState;
};

export default function AuthenticationUserDirectory() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [after, setAfter] = useState<string>();
  const [next, setNext] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ view: 'users', q: query });
      if (after) params.set('after', after);
      void fetch(`/api/auth/control?${params}`, { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Directory unavailable.');
          setUsers(body.data.users);
          setNext(body.data.nextCursor);
        })
        .catch(failure => {
          if (!controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : 'Directory unavailable.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, after]);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-sm">
            <Users className="h-4 w-4" />
            Account authentication
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Roles and identity links · 25 accounts per page
          </p>
        </div>
        <label className="relative sm:w-72">
          <span className="sr-only">Search authentication accounts</span>
          <Search className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name or email"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setAfter(undefined);
              setHistory([]);
            }}
          />
        </label>
      </div>

      {/* Yellow informational note: First-link approval guidance & link to Users directory */}
      <div className="border-b bg-amber-50/70 p-4 dark:bg-amber-950/20">
        <div className="flex items-start gap-3 rounded-lg border border-amber-300/70 bg-amber-100/50 p-3.5 text-amber-950 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 text-xs space-y-1">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              First-Link Approval for Existing Accounts
            </p>
            <p className="leading-relaxed text-amber-800 dark:text-amber-300">
              Existing accounts require administrator approval before signing in with SSO for the first time.
              You can authorize first-link access directly using the <strong>Allow linking</strong> button (or <strong>•••</strong> menu) on any account below, or manage approvals in bulk from the{' '}
              <Link
                href="/users"
                className="font-semibold underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100 inline-flex items-center gap-0.5"
              >
                Users directory
                <ExternalLink className="h-3 w-3 inline ml-0.5" />
              </Link>.
            </p>
          </div>
        </div>
      </div>

      {loading && (
        <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading accounts…
        </p>
      )}
      {error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {!loading && !error && !users.length && (
        <p className="p-8 text-center text-sm text-muted-foreground">No matching accounts.</p>
      )}
      {!error && (
        <ul className="divide-y divide-border">
          {users.map(user => (
            <li
              key={user.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                <p className="text-xs text-muted-foreground break-all">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{user.role}</Badge>
                <Badge variant="neutral">{user.roleSource}</Badge>

                {/* Direct inline first-link action / status */}
                <OidcLinkingApprovalButton
                  userId={user.id}
                  userName={user.name || user.email}
                  initialState={user.linkingState}
                  variant="button"
                  onStateChange={nextState => {
                    setUsers(prev =>
                      prev.map(u => (u.id === user.id ? { ...u, linkingState: nextState } : u))
                    );
                  }}
                />

                {/* Actions dropdown menu matching the user page UI */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Actions for {user.name || user.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 p-1.5 rounded-xl border shadow-xl">
                    <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground font-semibold">
                      Account & Identity
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator className="my-1" />
                    <OidcLinkingApprovalButton
                      userId={user.id}
                      userName={user.name || user.email}
                      initialState={user.linkingState}
                      variant="dropdown"
                      onStateChange={nextState => {
                        setUsers(prev =>
                          prev.map(u => (u.id === user.id ? { ...u, linkingState: nextState } : u))
                        );
                      }}
                    />
                    <DropdownMenuItem
                      onClick={() => router.push(`/users?q=${encodeURIComponent(user.email)}`)}
                      className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium"
                    >
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      <span>Manage in Users directory</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t bg-muted/10 p-3">
        <p className="text-xs text-muted-foreground">Showing {users.length} accounts</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !history.length}
            onClick={() => {
              setAfter(history[history.length - 1]);
              setHistory(previous => previous.slice(0, -1));
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !next}
            onClick={() => {
              setHistory(previous => [...previous, after]);
              setAfter(next || undefined);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
