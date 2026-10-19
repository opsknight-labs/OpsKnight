'use client';
import { AlertTriangle, History, Info, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { noticeClasses } from './status';

export function GlobalSwitchNotice() {
  return (
    <div className={cn('flex gap-2.5 rounded-lg border p-3 text-sm', noticeClasses.warn)}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        Automation is globally disabled. An administrator can enable it in Settings → System →
        Automation. Drafts and sample tests remain available.
      </p>
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetrySave,
}: {
  message: string;
  onRetrySave?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm',
        noticeClasses.error
      )}
    >
      <p className="flex min-w-0 gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="break-words">{message}</span>
      </p>
      {onRetrySave && (
        <Button size="sm" variant="outline" className="h-10 sm:h-9" onClick={onRetrySave}>
          <RotateCcw aria-hidden="true" />
          Retry save
        </Button>
      )}
    </div>
  );
}

export function UndoNotice({
  label,
  disabled,
  onUndo,
}: {
  label: string;
  disabled: boolean;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm shadow-sm"
    >
      <span className="min-w-0 break-words">{label}</span>
      <Button variant="outline" className="h-10 shrink-0" disabled={disabled} onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        Undo
      </Button>
    </div>
  );
}

export function RecoveryNotice({
  onReview,
  onDismiss,
}: {
  onReview: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm',
        noticeClasses.info
      )}
    >
      <p className="flex items-center gap-2">
        <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />A local
        recovery copy of unsaved edits is available.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={onReview}>
          Review recovered draft
        </Button>
        <Button size="sm" variant="ghost" className="h-10 sm:h-9" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
