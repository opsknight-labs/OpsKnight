'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import type { DiagnosticItem } from '@/lib/auth-control/diagnostic-contract';

export default function DiagnosticDetails({
  item,
  onClose,
  pending,
  onAction,
}: {
  item: DiagnosticItem;
  onClose: () => void;
  pending: boolean;
  onAction: (item: DiagnosticItem) => Promise<boolean>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const eligible = item.canRevoke || item.canRetry;
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !working) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto [overflow-wrap:anywhere]">
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>{item.source}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {item.details.map((entry, index) => (
            <div key={`${entry.label}-${index}`}>
              <dt className="text-xs text-muted-foreground">{entry.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{entry.value}</dd>
            </div>
          ))}
        </dl>
        {item.timeline && (
          <section aria-label="Recorded delivery timeline">
            <h3 className="mb-3 font-medium">Recorded delivery timeline</h3>
            <ol className="space-y-3 border-l border-border pl-4 text-sm">
              {item.timeline.map((entry, index) => (
                <li key={`${entry.label}-${index}`}>
                  <p className="font-medium">{entry.label}</p>
                  <time className="text-xs text-muted-foreground" dateTime={entry.at}>
                    {new Date(entry.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Only persisted stages are shown. Provider acceptance is not delivery confirmation.
            </p>
          </section>
        )}
        {item.actionExplanation && (
          <p className="text-sm text-muted-foreground">{item.actionExplanation}</p>
        )}
        {eligible && (
          <div className="space-y-3 border-t border-border pt-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={working || pending}
                onChange={event => setConfirmed(event.target.checked)}
              />
              {item.canRetry
                ? 'I understand an uncertain earlier delivery may result in a duplicate email.'
                : 'I understand this registered session will lose access immediately.'}
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              variant={item.canRevoke ? 'destructive' : 'default'}
              disabled={!confirmed || pending || working}
              aria-describedby="diagnostic-action-helper"
              onClick={() => {
                setWorking(true);
                setError('');
                void onAction(item)
                  .then(success => {
                    if (success) onClose();
                    else
                      setError(
                        'The operation did not complete. Refresh the record and verify your authentication before retrying.'
                      );
                  })
                  .catch(failure =>
                    setError(failure instanceof Error ? failure.message : 'Operation unavailable.')
                  )
                  .finally(() => setWorking(false));
              }}
            >
              {working
                ? 'Working…'
                : item.canRetry
                  ? 'Confirm email retry'
                  : 'Confirm session revocation'}
            </Button>
            <p id="diagnostic-action-helper" className="text-xs text-muted-foreground">
              {!confirmed
                ? 'Confirm the consequence above to continue.'
                : 'The server rechecks your current authority and the record before acting.'}
            </p>
          </div>
        )}
        <Button variant="outline" disabled={working} onClick={onClose}>
          Close details
        </Button>
      </DialogContent>
    </Dialog>
  );
}
