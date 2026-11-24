'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { notify } from '@/lib/toast';
import { addCustomerReportAction } from '@/app/(app)/services/business/phase5b-actions';

/** Manual customer report: how many customers wrote in during the last N minutes. */
export default function AddCustomerReportForm({
  businessServiceId,
}: {
  businessServiceId: string;
}) {
  const router = useRouter();
  const [count, setCount] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3 text-sm">
      <div className="space-y-1">
        <label htmlFor="cr-count" className="text-xs font-semibold">
          Customer reports
        </label>
        <Input
          id="cr-count"
          value={count}
          onChange={event => setCount(event.target.value)}
          inputMode="numeric"
          placeholder="12"
          className="h-9 w-28"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="cr-minutes" className="text-xs font-semibold">
          In the last (minutes)
        </label>
        <Input
          id="cr-minutes"
          value={minutes}
          onChange={event => setMinutes(event.target.value)}
          inputMode="numeric"
          className="h-9 w-28"
        />
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        Add report
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
