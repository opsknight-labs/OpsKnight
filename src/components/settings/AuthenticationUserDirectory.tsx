'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Search, Users, Loader2 } from 'lucide-react';
type User = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  roleSource: string;
  issuers: string[];
};
export default function AuthenticationUserDirectory() {
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
                <span className="text-xs text-muted-foreground">
                  {user.issuers.length ? 'Identity linked' : 'First-link approval required'}
                </span>
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
