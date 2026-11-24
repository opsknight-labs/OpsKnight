'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, CircleDashed, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui';
import { checkCustomDomainDnsAction } from '@/app/(app)/settings/status-pages/[pageId]/domain-actions';
import type { DomainDnsResult } from '@/lib/status-pages/domain-dns';

const STATE_UI = {
  verified: {
    Icon: CheckCircle2,
    label: 'Verified',
    tone: 'text-emerald-700 dark:text-emerald-400',
  },
  pending: { Icon: CircleDashed, label: 'Pending', tone: 'text-amber-700 dark:text-amber-400' },
  mismatch: { Icon: TriangleAlert, label: 'Mismatch', tone: 'text-red-700 dark:text-red-400' },
} as const;

/** DNS-only verification of the saved custom domain. TLS is terminated by the deployment's proxy. */
export default function StatusPageDomainCheck({
  pageId,
  savedDomain,
  unsaved,
}: {
  pageId: string;
  savedDomain: string | null;
  /** The field differs from what is stored, so a check would test the old value. */
  unsaved: boolean;
}) {
  const [result, setResult] = useState<DomainDnsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!savedDomain) return null;
  const ui = result ? STATE_UI[result.state] : null;
  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {unsaved ? 'Save the domain to check its DNS.' : `Check DNS for ${savedDomain}`}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || unsaved}
          onClick={() =>
            startTransition(async () => {
              const response = await checkCustomDomainDnsAction(pageId);
              if ('error' in response) {
                setError(response.error);
                setResult(null);
              } else {
                setError(null);
                setResult(response.result);
              }
            })
          }
        >
          {pending ? 'Checking…' : 'Check DNS'}
        </Button>
      </div>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        )}
        {result && ui && (
          <div className="mt-2 space-y-1.5">
            <p className={`flex items-center gap-1.5 font-semibold ${ui.tone}`}>
              <ui.Icon className="h-3.5 w-3.5" aria-hidden />
              {ui.label}: <span className="font-normal text-foreground">{result.message}</span>
            </p>
            {result.state !== 'verified' && (
              <p className="text-muted-foreground">
                Create this record at your DNS provider:{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                  {result.expected.type} {result.expected.host} → {result.expected.value}
                </code>
              </p>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-muted-foreground">
        HTTPS certificates are managed by your proxy or load balancer, not by OpsKnight, so TLS
        status is not shown here.
      </p>
    </div>
  );
}
