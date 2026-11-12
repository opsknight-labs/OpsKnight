import type { IncidentSummary } from '../drafts/schemas';

/** Hard cap on the note body; well inside what the note composer accepts. */
export const SUMMARY_NOTE_MAX_LENGTH = 6_000;

/**
 * Renders an incident summary as a plain-text incident note. Deterministic and pure so the exact text a
 * responder posts is testable; it says where it came from so readers know to verify it.
 */
export function formatSummaryAsNote(
  summary: IncidentSummary,
  source: { kind: 'ai' | 'deterministic'; model?: string | null }
): string {
  const lines: string[] = [`Summary: ${summary.headline}`, '', summary.currentState];
  if (summary.impact) lines.push('', `Impact: ${summary.impact}`);
  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push('', `${title}:`, ...items.map(item => `- ${item}`));
  };
  list('Key events', summary.keyEvents);
  list('Possible causes (to verify)', summary.possibleCauses);
  list('Suggested next steps', summary.nextSteps);
  lines.push(
    '',
    source.kind === 'ai'
      ? `(AI-generated summary${source.model ? ` by ${source.model}` : ''}, posted by a responder. Verify before relying on it.)`
      : '(Summary generated from the incident record, posted by a responder.)'
  );
  return lines.join('\n').slice(0, SUMMARY_NOTE_MAX_LENGTH);
}
