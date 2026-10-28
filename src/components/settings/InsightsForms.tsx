'use client';

import { useActionState } from 'react';
import {
  applyMinScoreSuggestion,
  saveDigestSettingsAction,
  sendTestDigestAction,
  type InsightsActionState,
} from '@/app/(app)/settings/intelligence/insights/actions';
import { Button } from '@/components/ui/shadcn/button';
import { DIGEST_DAYS } from '@/lib/intelligence/digest/contract';

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

function Message({ state }: { state: InsightsActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
      {state.message}
    </p>
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function DigestSettingsForm({
  settings,
  canManage,
}: {
  settings: { enabled: boolean; dayOfWeek: number; hourUtc: number; revision: number };
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveDigestSettingsAction, initial);
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-4 py-3">
      <input type="hidden" name="expectedRevision" value={settings.revision} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={disabled} className="mt-1 h-4 w-4" />
        <span>
          <span className="font-medium">Email a weekly digest</span>
          <span className="block text-muted-foreground">
            Sent to active people who can manage intelligence. Each person only sees services they can already read.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Day</span>
          <select name="dayOfWeek" defaultValue={settings.dayOfWeek} disabled={disabled} className={selectClass}>
            {DIGEST_DAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Time (UTC)</span>
          <select name="hourUtc" defaultValue={settings.hourUtc} disabled={disabled} className={selectClass}>
            {HOURS.map(hour => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        {canManage && (
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save schedule'}
          </Button>
        )}
      </div>
      <Message state={state} />
    </form>
  );
}

export function SendTestDigestButton() {
  const [state, action, pending] = useActionState(sendTestDigestAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Sending…' : 'Send me a test'}
      </Button>
      <Message state={state} />
    </form>
  );
}
