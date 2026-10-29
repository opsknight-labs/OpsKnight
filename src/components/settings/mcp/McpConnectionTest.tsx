'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { notify } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';

type Check = { id: string; status: 'pass' | 'warn' | 'fail'; message: string };
type Report = { ready: boolean; checks: Check[] };

const ICON = {
  pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Passed" />,
  warn: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Warning" />,
  fail: <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Failed" />,
};

/** Runs the read-only readiness checks from the server and lists what to fix. */
export default function McpConnectionTest({ action }: { action: () => Promise<Report> }) {
  const [report, setReport] = useState<Report | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              setReport(await action());
            } catch (error) {
              notify.error(error, { id: 'settings:mcp:test' });
            }
          })
        }
      >
        {pending ? 'Testing…' : 'Test connection'}
      </Button>
      {report && (
        <div aria-live="polite" className="space-y-2">
          <p className="text-sm font-medium">
            {report.ready
              ? 'Everything needed for assistants to connect is working.'
              : 'Fix these to finish setup:'}
          </p>
          <ul className="space-y-1.5 text-sm">
            {report.checks.map((check, index) => (
              <li key={`${check.id}-${index}`} className="flex items-start gap-2">
                <span className="mt-0.5">{ICON[check.status]}</span>
                <span>{check.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
