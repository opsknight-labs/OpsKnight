'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Activity, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import { formatDateTime } from '@/lib/timezone';
import { StatusPill, type PillTone } from '@/components/settings/mcp/McpListKit';
import type { McpConnectionActivity } from '@/app/(app)/settings/integrations/mcp/activity';

/** Plain labels for the bounded request outcomes recorded in the activity log. */
const OUTCOME = new Map<string, { label: string; tone: PillTone }>([
  ['served', { label: 'Answered', tone: 'success' }],
  ['task_created', { label: 'Started a task', tone: 'success' }],
  ['subscription_opened', { label: 'Listening', tone: 'info' }],
  ['tool_error', { label: 'Tool error', tone: 'warning' }],
  ['protocol_rejected', { label: 'Rejected request', tone: 'warning' }],
  ['subscription_rejected', { label: 'Rejected request', tone: 'warning' }],
  ['invalid_request', { label: 'Invalid request', tone: 'warning' }],
  ['result_too_large', { label: 'Result too large', tone: 'warning' }],
  ['rate_limited', { label: 'Rate limited', tone: 'warning' }],
  ['busy', { label: 'Server busy', tone: 'warning' }],
  ['unauthenticated', { label: 'Not signed in', tone: 'danger' }],
  ['forbidden', { label: 'Not allowed', tone: 'danger' }],
  ['disabled', { label: 'MCP turned off', tone: 'danger' }],
  ['unavailable', { label: 'Unavailable', tone: 'danger' }],
  ['error', { label: 'Server error', tone: 'danger' }],
]);

export function outcomeMeta(outcome: string) {
  return OUTCOME.get(outcome) ?? { label: outcome, tone: 'neutral' as PillTone };
}

function what(call: McpConnectionActivity['calls'][number]) {
  if (call.tool === 'none') return 'Discovery';
  return call.operationId && call.operationId !== call.tool
    ? `${call.tool} · ${call.operationId}`
    : call.tool;
}

export default function McpActivityDrawer({
  grantId,
  label,
  timeZone,
  load,
}: {
  grantId: string;
  /** Who and which assistant, for the title and the button's accessible name. */
  label: string;
  timeZone: string;
  load: (input: {
    grantId: string;
    cursor?: { at: string; id: string };
  }) => Promise<McpConnectionActivity>;
}) {
  const [data, setData] = useState<McpConnectionActivity | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchPage = useCallback(
    async (cursor?: { at: string; id: string }) => {
      setLoading(true);
      setFailed(false);
      try {
        const page = await load(cursor ? { grantId, cursor } : { grantId });
        setData(previous =>
          cursor && previous
            ? { ...page, calls: [...previous.calls, ...page.calls], changes: previous.changes }
            : page
        );
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [grantId, load]
  );

  // A write's audit row carries the request id of the MCP call that made it.
  const changeByRequest = new Map(
    (data?.changes ?? []).flatMap(change =>
      change.requestId ? [[change.requestId, change] as const] : []
    )
  );
  const changeAnchor = (id: string) => `mcp-change-${grantId}-${id}`;

  const time = (iso: string) => formatDateTime(iso, timeZone, { includeTimeZone: true });

  return (
    <Sheet
      onOpenChange={open => {
        if (open && !data && !loading) void fetchPage();
      }}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-label={`Activity for ${label}`}
        >
          <Activity className="h-4 w-4" aria-hidden="true" />
          Activity
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Activity: {label}</SheetTitle>
          <SheetDescription>
            Requests this connection made in the last 30 days, newest first. Arguments and results
            are never recorded.
          </SheetDescription>
        </SheetHeader>

        <section aria-labelledby={`mcp-changes-${grantId}`} className="mt-6 space-y-2">
          <h3 id={`mcp-changes-${grantId}`} className="text-sm font-semibold text-foreground">
            Changes made
          </h3>
          {data && data.changes.length === 0 && (
            <p className="text-xs text-muted-foreground">No changes recorded.</p>
          )}
          {data && data.changes.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.changes.map(change => (
                <li
                  key={change.id}
                  id={changeAnchor(change.id)}
                  className="flex flex-col gap-0.5 px-3 py-2 text-xs"
                >
                  <code className="font-mono text-foreground">{change.action}</code>
                  <time dateTime={change.at} className="text-muted-foreground">
                    {time(change.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {data?.historyHref && (
            <Link
              href={data.historyHref}
              className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Full change history in API activity
            </Link>
          )}
        </section>

        <section aria-labelledby={`mcp-calls-${grantId}`} className="mt-6 space-y-2">
          <h3 id={`mcp-calls-${grantId}`} className="text-sm font-semibold text-foreground">
            Requests
          </h3>
          {failed && (
            <p role="alert" className="text-xs text-destructive">
              Activity could not be loaded. Try again.
            </p>
          )}
          {data && data.calls.length === 0 && (
            <p className="text-xs text-muted-foreground">No requests in the last 30 days.</p>
          )}
          {data && data.calls.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.calls.map(call => {
                const meta = outcomeMeta(call.outcome);
                const change = changeByRequest.get(call.requestId);
                return (
                  <li key={call.id} className="flex flex-col gap-1 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="font-mono text-foreground">{what(call)}</code>
                      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-muted-foreground">
                      <time dateTime={call.at}>{time(call.at)}</time>
                      <span>{call.durationMs} ms</span>
                      {call.errorCode && <code className="font-mono">{call.errorCode}</code>}
                      <span className="font-mono" title="Request id (X-Request-Id)">
                        {call.requestId.slice(0, 8)}
                      </span>
                      {change && (
                        <a
                          href={`#${changeAnchor(change.id)}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Changed: {change.action}
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading activity
            </p>
          )}
          {data?.next && !loading && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchPage(data.next!)}
            >
              Show older requests
            </Button>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
