'use client';

import { useActionState } from 'react';
import { applyMinScoreSuggestion, type InsightsActionState } from '@/app/(app)/settings/intelligence/insights/actions';
import { Button } from '@/components/ui/shadcn/button';

const initial: InsightsActionState = { message: '', ok: false };

export function ApplySuggestionForm({ suggested, expectedHeadVersion }: { suggested: number; expectedHeadVersion: number }) {
  const [state, action, pending] = useActionState(applyMinScoreSuggestion, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="suggested" value={suggested} />
      <input type="hidden" name="expectedHeadVersion" value={expectedHeadVersion} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Applying…' : `Set threshold to ${suggested}`}
      </Button>
      {state.message && (
        <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
          {state.message}
        </p>
      )}
    </form>
  );
}
