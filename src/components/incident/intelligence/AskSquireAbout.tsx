'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { openSquire, type SquireEvidenceHandle } from '@/components/squire/squire-bus';

const MAX_QUESTION = 400;

/**
 * "Ask Squire about this" on one intelligence item: opens the assistant with the question prefilled in the
 * composer (not sent) and hands it the item's evidence handle and the incident, per the bus contract in
 * `squire-bus.ts`. Rendered only when the assistant is enabled for this viewer and surface.
 */
export default function AskSquireAbout({
  assistantName,
  question,
  subject,
  evidence,
  incidentId,
}: {
  assistantName: string;
  question: string;
  /** What the question is about, for the accessible name: "Ask Pip about <subject>". */
  subject: string;
  evidence: SquireEvidenceHandle;
  incidentId: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        openSquire({ question: question.slice(0, MAX_QUESTION), evidence, incidentId })
      }
      aria-label={`Ask ${assistantName} about ${subject}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
    >
      <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
      Ask {assistantName}
    </button>
  );
}
