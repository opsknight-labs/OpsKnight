import type {
  PublicIncidentImpact,
  PublicIncidentStatus,
  PublicMaintenanceState,
  PublicStatusPageSnapshot,
} from './public-contract';

/**
 * One normalized public event stream for every fan-out surface (RSS, email, webhook, feeds).
 *
 * Each surface used to re-derive its own titles, ordering and disclosure from raw records; this
 * projects the already-sanitized V3 snapshot into a single ordered event list so they cannot drift.
 * It is a feed projector over the sanitized V3 snapshot. RSS consumes this list; email and
 * webhooks still have their own loops. Do not treat this module as evidence that every fan-out
 * surface is unified.
 */

export type PublicStatusEventKind = 'INCIDENT' | 'MAINTENANCE' | 'ANNOUNCEMENT' | 'CHANGELOG';

export interface PublicStatusEventV3 {
  /** Stable feed key: the real public id when disclosed, otherwise a deterministic content key. */
  id: string;
  kind: PublicStatusEventKind;
  title: string;
  body?: string;
  status?: PublicIncidentStatus | PublicMaintenanceState;
  impact?: PublicIncidentImpact;
  publishedAt: string;
  updatedAt?: string;
  affectedServices?: Array<{ id: string; name: string }>;
  affectedRegions?: string[];
}

/** Deterministic FNV-1a key so an event without a disclosed id still dedupes stably across surfaces. */
function contentKey(kind: string, title: string, when: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${kind}|${title}|${when}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${kind.toLowerCase()}-${(hash >>> 0).toString(16)}`;
}

function latest(...values: Array<string | undefined>): string | undefined {
  let max: string | undefined;
  for (const value of values) {
    if (value && (!max || value > max)) max = value;
  }
  return max;
}

/**
 * Project the public snapshot into a single, stably ordered event feed (newest first).
 *
 * Ordering is deterministic ΓÇö publishedAt then id ΓÇö so an unchanged snapshot always yields an
 * identical feed and never forces a needless cache invalidation downstream.
 */
export function projectPublicStatusEvents(
  snapshot: PublicStatusPageSnapshot
): PublicStatusEventV3[] {
  const events: PublicStatusEventV3[] = [];

  for (const incident of snapshot.incidents) {
    const publishedAt = incident.createdAt ?? incident.resolvedAt ?? snapshot.generatedAt;
    const eventId =
      incident.id ??
      incident.publicEventId ??
      contentKey('INCIDENT', incident.title ?? 'Incident', publishedAt);
    events.push({
      id: eventId,
      kind: 'INCIDENT',
      title: incident.title ?? 'Service incident',
      ...(incident.description ? { body: incident.description } : {}),
      status: incident.status,
      ...(incident.publicImpact ? { impact: incident.publicImpact } : {}),
      publishedAt,
      ...(latest(incident.acknowledgedAt, incident.resolvedAt)
        ? { updatedAt: latest(incident.acknowledgedAt, incident.resolvedAt) }
        : {}),
      ...(incident.service?.id && incident.service.name
        ? { affectedServices: [{ id: incident.service.id, name: incident.service.name }] }
        : {}),
      ...(incident.service?.regions?.length ? { affectedRegions: incident.service.regions } : {}),
    });
  }

  for (const item of snapshot.maintenance ?? []) {
    events.push({
      id: item.id,
      kind: 'MAINTENANCE',
      title: item.title,
      ...(item.description ? { body: item.description } : {}),
      status: item.state,
      publishedAt: item.startAt,
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
      ...(item.affectedServices?.length ? { affectedServices: item.affectedServices } : {}),
      ...(item.affectedRegions?.length ? { affectedRegions: item.affectedRegions } : {}),
    });
  }

  for (const item of snapshot.announcements) {
    if (item.type === 'MAINTENANCE' || item.type === 'UPDATE') continue;
    events.push({
      id: item.id,
      kind: 'ANNOUNCEMENT',
      title: item.title,
      ...(item.message ? { body: item.message } : {}),
      publishedAt: item.startDate,
      ...(item.affectedServices?.length ? { affectedServices: item.affectedServices } : {}),
      ...(item.affectedRegions?.length ? { affectedRegions: item.affectedRegions } : {}),
    });
  }

  for (const item of snapshot.changelog ?? []) {
    events.push({
      id: item.id,
      kind: 'CHANGELOG',
      title: item.title,
      ...(item.message ? { body: item.message } : {}),
      publishedAt: item.publishedAt,
      ...(item.affectedServices?.length ? { affectedServices: item.affectedServices } : {}),
    });
  }

  return events.sort((a, b) =>
    a.publishedAt === b.publishedAt
      ? a.id.localeCompare(b.id)
      : a.publishedAt < b.publishedAt
        ? 1
        : -1
  );
}
