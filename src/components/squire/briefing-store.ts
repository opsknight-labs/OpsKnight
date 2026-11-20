'use client';

import { useSyncExternalStore } from 'react';
import type { PinnedBriefing } from '@/lib/intelligence/squire/briefing-view';
import { findingHref, type SquireEvidenceKind } from './squire-bus';

/**
 * The pinned briefing per incident, shared between the panel's pinned card (which loads it) and the
 * citation links under an answer (which point at the same findings). Held in memory for the page view.
 */
export type { PinnedBriefing };

const briefings = new Map<string, PinnedBriefing>();
const listeners = new Set<() => void>();

export function setPinnedBriefing(incidentId: string, briefing: PinnedBriefing | null): void {
  if (briefing) briefings.set(incidentId, briefing);
  else briefings.delete(incidentId);
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePinnedBriefing(incidentId: string | undefined): PinnedBriefing | null {
  return useSyncExternalStore(
    subscribe,
    () => (incidentId ? (briefings.get(incidentId) ?? null) : null),
    () => null
  );
}

const array = <T>(value: unknown, read: (row: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(value)
    ? value.flatMap(row => {
        const parsed = row && typeof row === 'object' ? read(row as Record<string, unknown>) : null;
        return parsed ? [parsed] : [];
      })
    : [];
const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Reads the API's answer defensively; anything malformed is treated as "nothing to pin". */
export function parsePinnedBriefing(value: unknown): PinnedBriefing | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const incidentId = str(raw.incidentId);
  if (!incidentId) return null;
  const briefing: PinnedBriefing = {
    incidentId,
    similar: array(raw.similar, row => {
      const findingId = str(row.findingId);
      const id = str(row.incidentId);
      const title = str(row.title);
      return findingId && id && title
        ? {
            findingId,
            incidentId: id,
            title,
            status: str(row.status) ?? '',
            matchPercent: num(row.matchPercent),
          }
        : null;
    }),
    changes: array(raw.changes, row => {
      const findingId = str(row.findingId);
      const changeId = str(row.changeId);
      const summary = str(row.summary);
      return findingId && changeId && summary
        ? {
            findingId,
            changeId,
            summary,
            kind: str(row.kind) ?? '',
            leadMinutes: num(row.leadMinutes),
          }
        : null;
    }),
    runbooks: array(raw.runbooks, row => {
      const findingId = str(row.findingId);
      const runbookId = str(row.runbookId);
      const name = str(row.name);
      return findingId && runbookId && name
        ? {
            findingId,
            runbookId,
            name,
            succeeded: num(row.succeeded),
            eligible: num(row.eligible),
          }
        : null;
    }),
  };
  const summary =
    raw.summary && typeof raw.summary === 'object'
      ? (raw.summary as Record<string, unknown>)
      : null;
  const headline = str(summary?.headline);
  briefing.summary = headline ? { headline, currentState: str(summary?.currentState) ?? '' } : null;
  return briefing.summary ||
    briefing.similar.length + briefing.changes.length + briefing.runbooks.length > 0
    ? briefing
    : null;
}

/**
 * The incident finding a cited source corresponds to, as a link to its anchor in the insights
 * inspector (`/incidents/<id>?insights=<section>#finding-<findingId>`). Undefined when the source is
 * not one of the incident's pinned findings.
 */
export function findingHrefForCitation(
  briefing: PinnedBriefing | null,
  citation: { kind: string; id: string },
  options: { mobile?: boolean } = {}
): string | undefined {
  if (!briefing) return undefined;
  const match: { kind: SquireEvidenceKind; id: string } | undefined =
    citation.kind === 'incident'
      ? briefing.similar
          .filter(row => row.incidentId === citation.id)
          .map(row => ({ kind: 'similar' as const, id: row.findingId }))[0]
      : citation.kind === 'change'
        ? briefing.changes
            .filter(row => row.changeId === citation.id)
            .map(row => ({ kind: 'change' as const, id: row.findingId }))[0]
        : citation.kind === 'runbook'
          ? briefing.runbooks
              .filter(row => row.runbookId === citation.id)
              .map(row => ({ kind: 'runbook' as const, id: row.findingId }))[0]
          : undefined;
  return match ? findingHref(briefing.incidentId, match, options) : undefined;
}
