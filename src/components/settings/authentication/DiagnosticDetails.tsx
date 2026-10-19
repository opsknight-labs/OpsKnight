'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { AlertTriangle, Clock, Info } from 'lucide-react';
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
          <DialogTitle className="text-base font-semibold">{item.title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {item.source}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 text-xs sm:text-sm sm:grid-cols-2">
          {item.details.map((entry, index) => (
            <div key={`${entry.label}-${index}`}>
              <dt className="text-xs font-medium text-muted-foreground">{entry.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs bg-background/60 p-2 rounded border border-border/50">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>

        {item.timeline && (
          <section
            aria-label="Recorded delivery timeline"
            className="rounded-xl border border-border/80 p-4 bg-card"
          >
            <h3 className="mb-3 font-semibold text-xs uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-primary" />
              Recorded delivery timeline
            </h3>
            <ol className="space-y-3 border-l-2 border-primary/30 pl-4 text-xs sm:text-sm">
              {item.timeline.map((entry, index) => (
                <li key={`${entry.label}-${index}`} className="relative">
                  <div className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <p className="font-semibold text-foreground">{entry.label}</p>
                  <time className="text-xs text-muted-foreground" dateTime={entry.at}>
                    {new Date(entry.at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              Only persisted stages are shown. Provider acceptance is not delivery confirmation.
            </p>
          </section>
        )}

        {item.actionExplanation && (
          <p className="text-xs text-muted-foreground leading-relaxed rounded-lg border border-border/50 bg-muted/20 p-3">
            {item.actionExplanation}
          </p>
        )}

        {eligible && (
          <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4">
            <label className="flex items-start gap-2.5 text-xs sm:text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                checked={confirmed}
                disabled={working || pending}
                onChange={event => setConfirmed(event.target.checked)}
              />
              <span className="font-medium text-foreground">
                {item.canRetry
                  ? 'I understand an uncertain earlier delivery may result in a duplicate email.'
                  : 'I understand this registered session will lose access immediately.'}
              </span>
            </label>
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
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
                      setError(
                        failure instanceof Error ? failure.message : 'Operation unavailable.'
                      )
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" disabled={working} onClick={onClose}>
            Close details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
