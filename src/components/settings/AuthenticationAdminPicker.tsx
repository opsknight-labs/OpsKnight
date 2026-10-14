'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Loader2, Search } from 'lucide-react';

type Admin = { id: string; email: string; name: string | null };
export default function AuthenticationAdminPicker({
  label,
  value,
  onChange,
  initialAdmins,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  initialAdmins: Admin[];
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState(initialAdmins);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [after, setAfter] = useState<string | undefined>();
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ view: 'admins', q: query });
      if (after) params.set('after', after);
      void fetch(`/api/auth/control?${params}`, { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Administrator search unavailable.');
          setUsers(previous => (after ? [...previous, ...body.data.users] : body.data.users));
          setCursor(body.data.nextCursor);
        })
        .catch(failure => {
          if (!controller.signal.aborted)
            setError(failure instanceof Error ? failure.message : 'Search unavailable.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, after, disabled]);
  const selected =
    users.find(user => user.id === value) ?? initialAdmins.find(user => user.id === value);
  return (
    <div className="space-y-2">
      {!disabled && (
        <label className="block space-y-2 text-sm">
          <span className="font-medium">Search administrators</span>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            />
            <Input
              className="pl-9"
              placeholder="Search by name or email"
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setAfter(undefined);
              }}
            />
          </div>
        </label>
      )}
      <label className="block space-y-2 text-sm">
        <span className="font-medium">{label}</span>
        <select
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">Select an active administrator</option>
          {value && !users.some(user => user.id === value) && (
            <option value={value}>{selected?.email ?? value}</option>
          )}
          {users.map(user => (
            <option key={user.id} value={user.id}>
              {user.name ? `${user.name} · ` : ''}
              {user.email}
            </option>
          ))}
        </select>
      </label>
      {loading && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Searching administrators…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {cursor && !disabled && (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setAfter(cursor)}>
          Load more administrators
        </Button>
      )}
    </div>
  );
}
