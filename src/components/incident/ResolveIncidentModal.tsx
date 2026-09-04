'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { resolveIncidentWithNote } from '@/app/(app)/incidents/actions';
import { useToast } from '@/hooks/use-product-notification';
import { cn } from '@/lib/utils';

export type ResolvingIncidentData = {
  id: string;
  title: string;
  service?: { name: string } | null;
};

type ResolveIncidentModalProps = {
  incident: ResolvingIncidentData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (incidentId: string) => void;
};

const MIN_RESOLUTION_LENGTH = 10;
const MAX_RESOLUTION_LENGTH = 1000;

export default function ResolveIncidentModal({
  incident,
  open,
  onOpenChange,
  onSuccess,
}: ResolveIncidentModalProps) {
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setResolutionNote('');
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const trimmed = resolutionNote.trim();
  const isTooShort = trimmed.length < MIN_RESOLUTION_LENGTH;
  const charsRemaining = MIN_RESOLUTION_LENGTH - trimmed.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incident || isTooShort || isPending) return;

    setError(null);
    startTransition(async () => {
      try {
        await resolveIncidentWithNote(incident.id, trimmed);
        showToast(
          `Incident #${incident.id.slice(-5).toUpperCase()} resolved successfully`,
          'success'
        );
        handleClose(false);
        onSuccess?.(incident.id);
        router.refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to resolve incident. Please try again.';
        setError(message);
        showToast(message, 'error');
      }
    });
  };

  if (!incident) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-card text-card-foreground border-border">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <DialogTitle className="text-lg font-bold text-foreground">
              Resolve Incident
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-normal">
            Mark incident{' '}
            <span className="font-mono font-semibold text-foreground">
              #{incident.id.slice(-5).toUpperCase()}
            </span>{' '}
            as resolved. A resolution note is required to provide context for postmortems and team
            auditing.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="rounded-lg bg-muted/40 p-3 border border-border/60">
            <p className="text-xs font-semibold text-foreground line-clamp-1">{incident.title}</p>
            {incident.service?.name && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Service:{' '}
                <span className="font-medium text-foreground">{incident.service.name}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="resolution-note" className="text-xs font-semibold text-foreground">
                Resolution Note <span className="text-rose-500">*</span>
              </Label>
              <span
                className={cn(
                  'text-[10px] tabular-nums',
                  isTooShort ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                )}
              >
                {trimmed.length > 0 && isTooShort
                  ? `${charsRemaining} more char${charsRemaining > 1 ? 's' : ''} needed`
                  : `${trimmed.length}/${MAX_RESOLUTION_LENGTH}`}
              </span>
            </div>

            <Textarea
              id="resolution-note"
              name="resolution"
              required
              minLength={MIN_RESOLUTION_LENGTH}
              maxLength={MAX_RESOLUTION_LENGTH}
              rows={4}
              value={resolutionNote}
              onChange={e => {
                setResolutionNote(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Describe the root cause, remediation steps, or permanent fix applied..."
              className="resize-none bg-background border-border text-sm focus-visible:ring-emerald-500"
              autoFocus
            />

            <p className="text-[11px] text-muted-foreground">
              Minimum 10 characters. Explain the solution applied so responders can reference it.
            </p>
          </div>

          {error && (
            <div className="p-2.5 rounded-md bg-rose-500/10 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2 text-rose-700 dark:text-rose-300 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleClose(false)}
              disabled={isPending}
              className="h-9 border-border hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isTooShort || isPending}
              className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Resolving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Resolve Incident</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
