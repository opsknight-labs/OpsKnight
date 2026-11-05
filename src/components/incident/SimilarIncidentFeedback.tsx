'use client';

import { useActionState, useOptimistic, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  rateSimilarIncident,
  type SimilarFeedbackState,
} from '@/app/(app)/incidents/[id]/intelligence-actions';
import { FEEDBACK_REASON_CODES } from '@/lib/intelligence/feedback/schema';

const REASON_LABEL = new Map<string, string>([
  ['WRONG_SERVICE', 'Wrong service'],
  ['UNRELATED', 'Unrelated'],
  ['OUTDATED', 'Outdated'],
  ['ALREADY_KNOWN', 'Already known'],
  ['DUPLICATE', 'Duplicate'],
  ['TOO_BROAD', 'Too broad'],
  ['OTHER', 'Other'],
]);
const NEGATIVE_REASONS = FEEDBACK_REASON_CODES.filter(code => code !== 'DUPLICATE' && code !== 'TOO_BROAD');

/** Thumbs up/down for one suggestion, updating optimistically and recovering if the save fails. */
export default function SimilarIncidentFeedback({
  incidentId,
  findingId,
  initialVerdict,
}: {
  incidentId: string;
  findingId: string;
  initialVerdict: 'HELPFUL' | 'NOT_HELPFUL' | null;
}) {
  const [state, action, pending] = useActionState<SimilarFeedbackState, FormData>(
    rateSimilarIncident.bind(null, incidentId),
    { ok: true, message: '', verdict: initialVerdict }
  );
  const [optimistic, setOptimistic] = useOptimistic(state.verdict);
  const [askReason, setAskReason] = useState(false);

  const submit = (verdict: 'HELPFUL' | 'NOT_HELPFUL' | 'REVOKE', reasonCode = '') => {
    const data = new FormData();
    data.set('findingId', findingId);
    data.set('verdict', verdict);
    if (reasonCode) data.set('reasonCode', reasonCode);
    setOptimistic(verdict === 'REVOKE' ? null : verdict);
    setAskReason(false);
    action(data);
  };
  const toggle = (verdict: 'HELPFUL' | 'NOT_HELPFUL') => {
    if (optimistic === verdict) return submit('REVOKE');
    if (verdict === 'NOT_HELPFUL') {
      setAskReason(true);
      return;
    }
    submit(verdict);
  };
  const base = 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted';

  return (
    <div className="flex flex-col items-end gap-1" aria-live="polite">
      <div className="flex items-center gap-1" role="group" aria-label="Was this suggestion helpful?">
        <button type="button" disabled={pending} aria-pressed={optimistic === 'HELPFUL'} aria-label="Helpful" onClick={() => toggle('HELPFUL')} className={`${base} ${optimistic === 'HELPFUL' ? 'bg-emerald-100 text-emerald-700' : ''}`}>
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" disabled={pending} aria-pressed={optimistic === 'NOT_HELPFUL'} aria-label="Not helpful" onClick={() => toggle('NOT_HELPFUL')} className={`${base} ${optimistic === 'NOT_HELPFUL' ? 'bg-rose-100 text-rose-700' : ''}`}>
          <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {askReason && (
        <div className="flex max-w-[16rem] flex-wrap justify-end gap-1" role="group" aria-label="Why was it not helpful?">
          {NEGATIVE_REASONS.map(code => (
            <button key={code} type="button" onClick={() => submit('NOT_HELPFUL', code)} className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted">
              {REASON_LABEL.get(code)}
            </button>
          ))}
          <button type="button" onClick={() => submit('NOT_HELPFUL')} className="rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:underline">
            Skip
          </button>
        </div>
      )}
      {!state.ok && state.message && (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}
