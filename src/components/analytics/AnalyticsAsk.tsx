'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { interpretAnalyticsQueryAction } from '@/app/(app)/insights/helper-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { ANALYTICS_QUERY_MAX_CHARS } from '@/lib/intelligence/helpers/analytics-query';

/**
 * "Show me high-urgency incidents on checkout this month": turns one sentence into the filter bar's own
 * settings and navigates there. Nothing is sent until the person submits.
 */
export default function AnalyticsAsk() {
  const inputId = useId();
  const router = useRouter();
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (text.trim().length < 3 || pending) return;
    setMessage('');
    startTransition(async () => {
      const result = await interpretAnalyticsQueryAction(text).catch(() => null);
      if (!result || Object.keys(result.filters).length === 0) {
        setMessage(
          'Could not turn that into filters. Try naming a service, team, urgency or period.'
        );
        return;
      }
      router.push(result.href);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-1.5" role="search" aria-label="Filter by question">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
        Ask in plain words
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          value={text}
          maxLength={ANALYTICS_QUERY_MAX_CHARS}
          onChange={event => setText(event.target.value)}
          placeholder="e.g. high urgency incidents on checkout in the last 30 days"
          className="min-h-11"
        />
        <Button type="submit" className="min-h-11" disabled={pending || text.trim().length < 3}>
          {pending ? 'Reading…' : 'Apply'}
        </Button>
      </div>
      {message && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}
