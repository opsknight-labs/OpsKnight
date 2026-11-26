'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import ConfirmDialog from '@/components/ConfirmDialog';
import { notify } from '@/lib/toast';
import {
  addCustomerReportAction,
  deleteCustomerReportAction,
} from '@/app/(app)/services/business/phase5b-actions';

/**
 * Manual customer report: how many customers wrote in during the last N minutes. Collapsed behind
 * an "Add customer report" button so the panel reads as data first.
 */
export default function AddCustomerReportForm({
  businessServiceId,
}: {
  businessServiceId: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add customer report
      </Button>
    );
  }

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const total = Number(count);
    const span = Number(minutes);
    if (
      !Number.isInteger(total) ||
      total < 1 ||
      !Number.isInteger(span) ||
      span < 1 ||
      span > 1440
    ) {
      setError('Enter a whole number of reports and a window of 1 to 1440 minutes.');
      return;
    }
    setError(null);
    const windowEnd = new Date();
    startTransition(async () => {
      const result = await addCustomerReportAction(businessServiceId, {
        source: 'manual',
        count: total,
        windowStart: new Date(windowEnd.getTime() - span * 60_000),
        windowEnd,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify.success('Customer report added');
      setCount('');
      close();
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add customer report"
      className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3 text-sm"
    >
      <div className="space-y-1">
        <label htmlFor={`${uid}-count`} className="text-xs font-medium text-muted-foreground">
          Customer reports
        </label>
        <Input
          id={`${uid}-count`}
          value={count}
          onChange={event => setCount(event.target.value)}
          inputMode="numeric"
          placeholder="12"
          autoFocus
          className="h-9 w-28"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${uid}-minutes`} className="text-xs font-medium text-muted-foreground">
          In the last (minutes)
        </label>
        <Input
          id={`${uid}-minutes`}
          value={minutes}
          onChange={event => setMinutes(event.target.value)}
          inputMode="numeric"
          className="h-9 w-28"
        />
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? 'Adding…' : 'Add report'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={close} disabled={isPending}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** Deletes a customer report the viewer recorded; asks first. */
export function DeleteCustomerReportButton({
  businessServiceId,
  reportId,
  label,
}: {
  businessServiceId: string;
  reportId: string;
  /** e.g. "12 manual reports", for the accessible name and the dialog. */
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${label}`}
        disabled={isPending}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <ConfirmDialog
        isOpen={confirming}
        title="Delete this customer report?"
        message={`${label} will no longer count towards this business service's health.`}
        confirmText={isPending ? 'Deleting…' : 'Delete report'}
        cancelText="Keep"
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteCustomerReportAction(businessServiceId, reportId);
            setConfirming(false);
            if (!result.ok) {
              notify.error(result.error);
              return;
            }
            notify.success('Customer report deleted');
            router.refresh();
          })
        }
      />
    </>
  );
}
