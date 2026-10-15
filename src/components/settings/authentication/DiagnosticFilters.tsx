'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  diagnosticQuerySchema,
  type DiagnosticQuery,
} from '@/lib/auth-control/diagnostic-contract';

const localDate = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const inputClass =
  'mt-1 block w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export default function DiagnosticFilters({
  query,
  onApply,
}: {
  query: DiagnosticQuery;
  onApply: (query: DiagnosticQuery) => void;
}) {
  const [draft, setDraft] = useState(query);
  const [error, setError] = useState('');
  const change = <K extends keyof DiagnosticQuery>(key: K, value: DiagnosticQuery[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setError('');
  };
  const states =
    query.view === 'sessions'
      ? ['ACTIVE', 'EXPIRED', 'REVOKED']
      : query.view === 'deliveries'
        ? ['FAILED', 'PENDING', 'ACCEPTED', 'DELIVERED', 'CANCELLED']
        : query.view === 'replicas'
          ? ['consistent', 'conflicting']
          : [];
  return (
    <form
      className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={event => {
        event.preventDefault();
        const parsed = diagnosticQuerySchema.safeParse({ ...draft, after: undefined });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Check the filters.');
          return;
        }
        onApply(parsed.data);
      }}
    >
      <label className="min-w-0 text-sm">
        {query.view === 'sessions'
          ? 'Search name, email or session record prefix'
          : query.view === 'audit'
            ? 'Search event type or identifier prefix'
            : query.view === 'replicas'
              ? 'Search replica identifier prefix'
              : 'Search event title or delivery identifier prefix'}
        <input
          className={inputClass}
          type="search"
          maxLength={100}
          value={draft.q}
          onChange={event => change('q', event.target.value)}
        />
      </label>
      {query.view === 'sessions' && (
        <label className="text-sm">
          Authentication method
          <select
            className={inputClass}
            value={draft.method}
            onChange={event => change('method', event.target.value as DiagnosticQuery['method'])}
          >
            <option value="all">All methods</option>
            <option value="credentials">Password</option>
            <option value="oidc">OIDC</option>
          </select>
        </label>
      )}
      {states.length > 0 && (
        <label className="text-sm">
          Record status
          <select
            className={inputClass}
            value={draft.state}
            onChange={event => change('state', event.target.value as DiagnosticQuery['state'])}
          >
            <option value="all">All statuses</option>
            {states.map(state => (
              <option key={state} value={state}>
                {state === 'ACCEPTED' ? 'Sent to provider' : state.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm">
        {query.view === 'replicas' ? 'Reports within' : 'Records created within'}
        <select
          className={inputClass}
          value={draft.range}
          onChange={event => change('range', event.target.value as DiagnosticQuery['range'])}
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All retained records</option>
          <option value="custom">Custom date range</option>
        </select>
      </label>
      {draft.range === 'custom' && (
        <>
          <label className="min-w-0 text-sm">
            Start time
            <input
              type="datetime-local"
              className={inputClass}
              value={draft.from ? localDate(draft.from) : ''}
              onChange={event =>
                change(
                  'from',
                  event.target.value ? new Date(event.target.value).toISOString() : undefined
                )
              }
            />
          </label>
          <label className="min-w-0 text-sm">
            End time
            <input
              type="datetime-local"
              className={inputClass}
              value={draft.to ? localDate(draft.to) : ''}
              onChange={event =>
                change(
                  'to',
                  event.target.value ? new Date(event.target.value).toISOString() : undefined
                )
              }
            />
          </label>
        </>
      )}
      {query.view === 'sessions' && (
        <label className="text-sm">
          Sort by
          <select
            className={inputClass}
            value={draft.sort}
            onChange={event => change('sort', event.target.value as DiagnosticQuery['sort'])}
          >
            <option value="activity">Last activity · newest first</option>
            <option value="created">Created · newest first</option>
            <option value="expires">Expiration · latest first</option>
          </select>
        </label>
      )}
      {query.view === 'audit' && (
        <>
          <label className="text-sm">
            Exact event type
            <input
              className={inputClass}
              value={draft.eventType}
              maxLength={128}
              placeholder="For example auth.emergency.login.success"
              onChange={event => change('eventType', event.target.value)}
            />
          </label>
          <label className="text-sm">
            Recorded outcome
            <select
              className={inputClass}
              value={draft.outcome}
              onChange={event => change('outcome', event.target.value)}
            >
              <option value="">All outcomes</option>
              {['success', 'failure', 'denied', 'revoked'].map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Recorded principal identifier
            <input
              className={inputClass}
              value={draft.actor}
              maxLength={128}
              onChange={event => change('actor', event.target.value)}
            />
          </label>
        </>
      )}
      {query.view === 'replicas' && (
        <label className="text-sm">
          Observation window
          <select
            className={inputClass}
            value={draft.observation}
            onChange={event =>
              change('observation', event.target.value as DiagnosticQuery['observation'])
            }
          >
            <option value="active">Active · reported within ten minutes</option>
            <option value="historical">Historical observations</option>
            <option value="all">All retained observations</option>
          </select>
        </label>
      )}
      <label className="text-sm">
        Page size
        <select
          className={inputClass}
          value={draft.pageSize}
          onChange={event => change('pageSize', Number(event.target.value))}
        >
          {[25, 50, 100].map(size => (
            <option key={size} value={size}>
              {size} records
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const next = diagnosticQuerySchema.parse({ view: query.view });
            setDraft(next);
            onApply(next);
          }}
        >
          Clear filters
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">
          {error}
        </p>
      )}
    </form>
  );
}
