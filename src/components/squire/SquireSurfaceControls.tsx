'use client';

import Link from 'next/link';
import { ListTree, X } from 'lucide-react';
import { findingHrefForCitation, usePinnedBriefing } from './briefing-store';
import { findingHref, insightsSectionFor, type SquireEvidenceHandle } from './squire-bus';

// 44 px on phones, compact beside the small chips of the desktop panel.
const ICON_BUTTON =
  'min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-6 sm:min-w-6';

const KIND_LABEL: Record<SquireEvidenceHandle['kind'], string> = {
  briefing: 'Briefing',
  triage: 'Triage suggestion',
  similar: 'Similar incident',
  related: 'Related incident',
  group: 'Incident group',
  cause: 'Likely cause',
  change: 'Change',
  upstream: 'Upstream incident',
  runbook: 'Runbook',
  impact: 'Impact',
  summary: 'Summary',
  'noise-decision': 'Noise decision',
  timeline: 'Timeline event',
  alert: 'Alert',
  incident: 'Incident',
  service: 'Service',
};

/**
 * The item a handed-over question is about. For an incident finding it links back to the finding's
 * anchor in the insights inspector; it can be dismissed, which only removes the chip.
 */
export function SquireEvidenceChip({
  evidence,
  incidentId,
  mobile = false,
  onDismiss,
}: {
  evidence: SquireEvidenceHandle | null;
  incidentId?: string;
  mobile?: boolean;
  onDismiss: () => void;
}) {
  if (!evidence) return null;
  const text = evidence.label ?? KIND_LABEL[evidence.kind];
  const href =
    incidentId && insightsSectionFor(evidence.kind)
      ? findingHref(incidentId, evidence, { mobile })
      : undefined;
  return (
    <div
      role="status"
      aria-label="About"
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-muted pl-2 text-xs text-ink-600"
    >
      <span className="shrink-0">About</span>
      {href ? (
        <Link
          href={href}
          title={`${KIND_LABEL[evidence.kind]}: ${text}`}
          className="flex min-h-11 min-w-0 items-center text-foreground underline-offset-2 hover:underline sm:min-h-6"
        >
          <span className="truncate font-medium">{text}</span>
        </Link>
      ) : (
        <span className="min-w-0 truncate font-medium text-foreground">{text}</span>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Remove this context"
        className={`inline-flex shrink-0 ${ICON_BUTTON}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Beside a cited source that is one of the incident's findings: a link to that finding in the insights
 * inspector (`#finding-<id>`). Renders nothing for any other source.
 */
export function SquireCitationFindingLink({
  citation,
  incidentId,
}: {
  citation: { kind: string; id: string; label: string };
  incidentId?: string;
}) {
  const briefing = usePinnedBriefing(incidentId);
  const mobile = typeof window !== 'undefined' && window.location.pathname.startsWith('/m/');
  const href = findingHrefForCitation(briefing, citation, { mobile });
  if (!href) return null;
  return (
    <Link
      href={href}
      aria-label={`Show ${citation.label} in this incident's insights`}
      title="Show in incident insights"
      className={`inline-flex shrink-0 border border-border text-muted-foreground ${ICON_BUTTON}`}
    >
      <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
