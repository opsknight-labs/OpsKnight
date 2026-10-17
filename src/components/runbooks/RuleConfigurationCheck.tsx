'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import type { BindingReadiness } from '@/lib/runbooks/binding-readiness';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';

const STATE_STYLE = {
  CONFIGURATION_VALID: 'border-emerald-500/30 bg-emerald-500/5',
  CHECKS_REQUIRED: 'border-amber-500/30 bg-amber-500/5',
  BLOCKED: 'border-rose-500/30 bg-rose-500/5',
  UNKNOWN: 'border-rose-500/30 bg-rose-500/5',
  PAUSED: 'border-border bg-muted/30',
} as const;

const CHECK_ICON = {
  passed: { icon: CheckCircle2, className: 'text-emerald-500' },
  deferred: { icon: AlertTriangle, className: 'text-amber-500' },
  blocked: { icon: XCircle, className: 'text-rose-500' },
} as const;

export default function RuleConfigurationCheck({
  action,
}: {
  action: () => Promise<BindingReadiness>;
}) {
  const { userTimeZone } = useTimezone();
  const [result, setResult] = useState<BindingReadiness>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          setError('');
          try {
            setResult(await action());
          } catch {
            setError('Configuration could not be checked. Retry after dependencies recover.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ClipboardCheck className="h-4 w-4" aria-hidden />
        )}
        {pending ? 'Checking configuration…' : 'Validate configuration · No execution'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div
          role="status"
          className={cn('space-y-2 rounded-lg border p-3 text-sm', STATE_STYLE[result.state])}
        >
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold capitalize">
              {result.state.replaceAll('_', ' ').toLowerCase()}
            </span>
            <time
              dateTime={result.checkedAt}
              title={formatDateTime(result.checkedAt, userTimeZone, {
                format: 'datetime',
                includeTimeZone: true,
              })}
              className="text-xs text-muted-foreground tabular-nums"
            >
              Checked{' '}
              {formatDateTime(result.checkedAt, userTimeZone, {
                format: 'time',
                includeTimeZone: true,
              })}
            </time>
          </p>
          {result.checks.length > 0 && (
            <ul className="space-y-1.5">
              {result.checks.map(check => {
                const { icon: Icon, className } = CHECK_ICON[check.state];
                return (
                  <li key={check.code} className="flex items-start gap-2">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', className)} aria-hidden />
                    <span className="min-w-0 break-words">
                      <span className="sr-only">{check.state}: </span>
                      {check.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            This check does not activate the rule or perform actions.
          </p>
        </div>
      )}
    </div>
  );
}
