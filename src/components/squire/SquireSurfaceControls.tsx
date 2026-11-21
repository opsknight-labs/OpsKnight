'use client';

import Link from 'next/link';
import { PanelRight, PictureInPicture2, ListTree, X } from 'lucide-react';
import { findingHrefForCitation, usePinnedBriefing } from './briefing-store';
import type { SquireDock } from './dock';
import { describeSquireContext } from './page-context';
import { findingHref, insightsSectionFor, type SquireEvidenceHandle } from './squire-bus';

const ICON_BUTTON =
  'min-h-11 min-w-11 items-center justify-center rounded hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

/** Header control that docks the panel beside the page or floats it again. Desktop only. */
export function SquireDockToggle({ dock, name }: { dock: SquireDock; name: string }) {
  if (!dock.available) return null;
  const label = dock.docked ? `Float ${name} over the page` : `Dock ${name} beside the page`;
  return (
    <button
      type="button"
      onClick={dock.toggle}
      aria-label={label}
      aria-pressed={dock.docked}
      title={dock.docked ? 'Float over the page' : 'Dock beside the page'}
      className={`hidden lg:inline-flex ${ICON_BUTTON}`}
    >
      {dock.docked ? (
        <PictureInPicture2 className="h-4 w-4" aria-hidden="true" />
      ) : (
        <PanelRight className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

/** What the conversation is about, from the page: an incident, a service, a team, a runbook, a schedule. */
export function SquireContextLabel({ pathname }: { pathname: string | null }) {
  const context = describeSquireContext(pathname);
  return <span data-squire-context={context.subject}>{context.label}</span>;
}

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
      className="flex items-center gap-2 border-b border-border bg-muted/20 pl-4 pr-1 text-xs"
    >
      <span className="shrink-0 text-muted-foreground">About</span>
      {href ? (
        <Link
          href={href}
          title={`${KIND_LABEL[evidence.kind]}: ${text}`}
          className="flex min-h-11 min-w-0 flex-1 items-center underline-offset-2 hover:underline"
        >
          <span className="truncate font-medium">{text}</span>
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Remove this context"
        className={`inline-flex shrink-0 text-muted-foreground ${ICON_BUTTON}`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
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
      className={`inline-flex shrink-0 rounded-lg border border-border text-muted-foreground ${ICON_BUTTON}`}
    >
      <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
