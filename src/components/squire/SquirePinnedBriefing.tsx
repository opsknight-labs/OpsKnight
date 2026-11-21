'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronDown, Pin } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import { parsePinnedBriefing, setPinnedBriefing, usePinnedBriefing } from './briefing-store';
import { findingHref } from './squire-bus';

const COLLAPSED_KEY = 'opsknight.squire.briefing';
const BRIEFING_URL = '/api/intelligence/squire/briefing';

const readCollapsed = () => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'collapsed';
  } catch {
    return false;
  }
};

const lead = (minutes: number) =>
  minutes < 1
    ? 'moments before'
    : minutes < 90
      ? `${Math.round(minutes)} min before`
      : `${Math.round(minutes / 60)} h before`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function Row({ href, title, detail }: { href?: string; title: string; detail: string }) {
  const body = (
    <>
      <span className="block truncate font-medium text-foreground">{title}</span>
      <span className="block truncate text-muted-foreground">{detail}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="flex min-h-11 flex-col justify-center rounded-md px-2 py-1 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-h-11 flex-col justify-center px-2 py-1">{body}</div>
      )}
    </li>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="px-2 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <ul>{children}</ul>
    </div>
  );
}

/**
 * The incident briefing, pinned above the conversation while the chat is about that incident.
 *
 * It renders nothing until the briefing has loaded and nothing at all when there is none (assistant or
 * intelligence off for the service, no findings, a failed read): the panel is never given an empty
 * card. Rows link to the finding's anchor in the incident's insights inspector, the one place each
 * finding lives. Whether it is collapsed is remembered per browser.
 */
export default function SquirePinnedBriefing({
  incidentId,
  mobile = false,
}: {
  incidentId: string;
  /** Link to the mobile incident routes. */
  mobile?: boolean;
}) {
  const briefing = usePinnedBriefing(incidentId);
  const [open, setOpen] = useState(() => !readCollapsed());

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `${BRIEFING_URL}?incidentId=${encodeURIComponent(incidentId)}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response?.ok) return;
        const body = (await response.json()) as { data?: { briefing?: unknown } };
        const parsed = parsePinnedBriefing(body?.data?.briefing);
        if (!controller.signal.aborted)
          setPinnedBriefing(incidentId, parsed?.incidentId === incidentId ? parsed : null);
      } catch {
        // The briefing is optional: on any failure the panel simply has nothing pinned.
      }
    })();
    return () => controller.abort();
  }, [incidentId]);

  if (!briefing) return null;

  const counts = [
    briefing.summary && 'summary',
    briefing.changes.length && plural(briefing.changes.length, 'change', 'changes'),
    briefing.similar.length && `${briefing.similar.length} similar`,
    briefing.runbooks.length && plural(briefing.runbooks.length, 'runbook', 'runbooks'),
  ].filter(Boolean);

  return (
    <Collapsible
      open={open}
      onOpenChange={next => {
        setOpen(next);
        try {
          window.localStorage.setItem(COLLAPSED_KEY, next ? 'open' : 'collapsed');
        } catch {
          // Without storage the choice lasts for this page view.
        }
      }}
      asChild
    >
      <section aria-label="Incident briefing" className="border-b border-border bg-muted/20">
        <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 px-4 text-left text-xs hover:bg-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2">
          <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">Incident briefing</span>
          <span className="min-w-0 truncate text-muted-foreground">{counts.join(' · ')}</span>
          <ChevronDown
            className="ml-auto h-4 w-4 shrink-0 text-muted-foreground group-data-[state=open]:rotate-180 motion-safe:transition-transform"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="max-h-56 overflow-y-auto px-2 pb-2 text-xs">
          {/* The same summary the insights inspector shows, never a second one written for the panel. */}
          {briefing.summary && (
            <div className="px-2 pt-2">
              <p className="font-medium text-foreground">{briefing.summary.headline}</p>
              {briefing.summary.currentState && (
                <p className="text-muted-foreground">{briefing.summary.currentState}</p>
              )}
            </div>
          )}
          {briefing.changes.length > 0 && (
            <Group label={briefing.changes.length === 1 ? 'Likely change' : 'Likely changes'}>
              {briefing.changes.map(change => (
                <Row
                  key={change.findingId}
                  href={findingHref(
                    incidentId,
                    { kind: 'change', id: change.findingId },
                    { mobile }
                  )}
                  title={change.summary}
                  detail={[change.kind.toLowerCase(), lead(change.leadMinutes)]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </Group>
          )}
          {briefing.similar.length > 0 && (
            <Group label="Similar incidents">
              {briefing.similar.map(similar => (
                <Row
                  key={similar.findingId}
                  href={findingHref(
                    incidentId,
                    { kind: 'similar', id: similar.findingId },
                    { mobile }
                  )}
                  title={similar.title}
                  detail={[`${similar.matchPercent}% match`, similar.status.toLowerCase()]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </Group>
          )}
          {briefing.runbooks.length > 0 && (
            <Group label="Runbooks that worked">
              {briefing.runbooks.map(runbook => (
                <Row
                  key={runbook.findingId}
                  href={findingHref(
                    incidentId,
                    { kind: 'runbook', id: runbook.findingId },
                    { mobile }
                  )}
                  title={runbook.name}
                  detail={`${runbook.succeeded} of ${plural(runbook.eligible, 'run', 'runs')} succeeded`}
                />
              ))}
            </Group>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
