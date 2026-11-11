import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../ai/redact';
import { withDbBudget } from '../jobs/db-budget';
import { resolveOverviewWindow } from '../overview/window';
import { LIST_DB_BUDGET, listReadableServiceOptions, type ListServiceOption } from './alerts';
import {
  encodeListCursor,
  LIST_PAGE_SIZE,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
  type ChangeListFilters,
  type ChangeRiskBand,
} from './contract';

/** Incidents opened up to this long after a change are looked at for a link to it. */
export const CHANGE_LINK_WINDOW_MS = 24 * 3_600_000;
/** Incidents examined for links per page; beyond it the page says links may be incomplete. */
export const CHANGE_LINK_INCIDENT_CAP = 500;
/** Recent changes sampled to offer sources in the filter. */
export const CHANGE_SOURCE_SAMPLE = 500;
const MAX_LINKED_SHOWN = 3;

export interface ChangeListRow {
  id: string;
  summary: string;
  source: string;
  kind: string;
  version: string | null;
  serviceId: string | null;
  serviceName: string | null;
  occurredAt: Date;
  /** 0..1 ranking signal, or null when the change has not been scored. Never a verdict. */
  riskScore: number | null;
  /** Readable incidents whose analysis points at this change as a possible cause. */
  linkedIncidents: Array<{ id: string; title: string }>;
  linkedIncidentCount: number;
}

export interface ChangeListPage {
  rows: ChangeListRow[];
  nextCursor: string | null;
  services: ListServiceOption[];
  servicesTruncated: boolean;
  sources: string[];
  /** True when more incidents fell in the page's time span than were examined for links. */
  linksTruncated: boolean;
}

type Client = typeof prisma;

/**
 * Changes the actor may read. A global reader sees every change, including ones not tied to a service;
 * a team-scoped reader sees changes of their teams' services only. Null when nothing is readable.
 */
export function changeReadWhere(actor: AuthorizationActor): Prisma.ChangeEventWhereInput | null {
  let service: Prisma.ServiceWhereInput;
  try {
    service = serviceReadWhere(actor);
  } catch {
    return null;
  }
  return Object.keys(service).length > 0 ? { service } : {};
}

function riskWhere(band: ChangeRiskBand): Prisma.ChangeEventWhereInput {
  switch (band) {
    case 'high':
      return { riskScore: { gte: RISK_HIGH_THRESHOLD } };
    case 'medium':
      return { riskScore: { gte: RISK_MEDIUM_THRESHOLD, lt: RISK_HIGH_THRESHOLD } };
    case 'low':
      return { riskScore: { lt: RISK_MEDIUM_THRESHOLD } };
    case 'unscored':
      return { riskScore: null };
  }
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * One page of recorded changes the actor may read, newest first: a keyset walk of
 * ChangeEvent(occurredAt) (or (serviceId, occurredAt) / (source, occurredAt)) inside the selected
 * window. Linked incidents come from the readable incidents opened in the page's time span, joined to
 * the finding lookup index; that probe is capped and the page says when the cap was reached.
 */
export async function listChangesForActor(
  actor: AuthorizationActor,
  filters: ChangeListFilters,
  options: { client?: Client; now?: Date; pageSize?: number } = {}
): Promise<ChangeListPage> {
  const empty: ChangeListPage = {
    rows: [],
    nextCursor: null,
    services: [],
    servicesTruncated: false,
    sources: [],
    linksTruncated: false,
  };
  const readable = changeReadWhere(actor);
  if (!readable) return empty;
  let readableIncidents: Prisma.IncidentWhereInput | null;
  try {
    readableIncidents = incidentReadWhere(actor);
  } catch {
    readableIncidents = null;
  }
  const pageSize = Math.min(Math.max(options.pageSize ?? LIST_PAGE_SIZE, 1), LIST_PAGE_SIZE);
  const { since, until } = resolveOverviewWindow(filters.window, options.now);
  const cursor = filters.cursor;

  return withDbBudget(
    LIST_DB_BUDGET,
    async tx => {
      const serviceFilter = await listReadableServiceOptions(tx, actor);
      const sample = await tx.changeEvent.findMany({
        where: { AND: [readable, { occurredAt: { gte: since, lt: until } }] },
        orderBy: { occurredAt: 'desc' },
        take: CHANGE_SOURCE_SAMPLE,
        select: { source: true },
      });
      const sources = [...new Set(sample.map(row => row.source))].sort((a, b) =>
        a.localeCompare(b)
      );

      const changes = await tx.changeEvent.findMany({
        where: {
          AND: [
            readable,
            { occurredAt: { gte: since, lt: until } },
            filters.serviceId ? { serviceId: filters.serviceId } : {},
            filters.source ? { source: filters.source } : {},
            filters.risk ? riskWhere(filters.risk) : {},
            cursor
              ? {
                  OR: [
                    { occurredAt: { lt: cursor.at } },
                    { occurredAt: cursor.at, id: { lt: cursor.id } },
                  ],
                }
              : {},
          ],
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          summary: true,
          source: true,
          kind: true,
          version: true,
          serviceId: true,
          occurredAt: true,
          riskScore: true,
          service: { select: { name: true } },
        },
      });
      const page = changes.slice(0, pageSize);

      const linked = new Map<string, Array<{ id: string; title: string }>>();
      let linksTruncated = false;
      if (page.length > 0 && readableIncidents) {
        const times = page.map(change => change.occurredAt.getTime());
        const incidents = await tx.incident.findMany({
          where: {
            AND: [
              readableIncidents,
              {
                createdAt: {
                  gte: new Date(Math.min(...times)),
                  lte: new Date(Math.max(...times) + CHANGE_LINK_WINDOW_MS),
                },
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: CHANGE_LINK_INCIDENT_CAP + 1,
          select: { id: true, title: true },
        });
        linksTruncated = incidents.length > CHANGE_LINK_INCIDENT_CAP;
        const candidates = incidents.slice(0, CHANGE_LINK_INCIDENT_CAP);
        const titles = new Map(candidates.map(incident => [incident.id, incident.title]));
        const findings = candidates.length
          ? await tx.intelligenceFinding.findMany({
              where: {
                incidentId: { in: candidates.map(incident => incident.id) },
                status: 'ACTIVE',
                kind: 'CHANGE_CORRELATION',
                subjectRef: { in: page.map(change => change.id) },
              },
              take: CHANGE_LINK_INCIDENT_CAP,
              select: { incidentId: true, subjectRef: true },
            })
          : [];
        for (const finding of findings) {
          if (!finding.subjectRef) continue;
          const list = linked.get(finding.subjectRef) ?? [];
          if (!list.some(entry => entry.id === finding.incidentId))
            list.push({
              id: finding.incidentId,
              title: clip(titles.get(finding.incidentId) ?? 'Incident', 160),
            });
          linked.set(finding.subjectRef, list);
        }
      }

      const last = page[page.length - 1];
      return {
        ...serviceFilter,
        sources,
        linksTruncated,
        rows: page.map(change => {
          const incidents = linked.get(change.id) ?? [];
          return {
            id: change.id,
            summary: clip(redactSecrets(change.summary), 300),
            source: change.source,
            kind: change.kind,
            version: change.version,
            serviceId: change.serviceId,
            serviceName: change.service?.name ?? null,
            occurredAt: change.occurredAt,
            riskScore: change.riskScore,
            linkedIncidents: incidents.slice(0, MAX_LINKED_SHOWN),
            linkedIncidentCount: incidents.length,
          };
        }),
        nextCursor:
          changes.length > pageSize && last
            ? encodeListCursor({ at: last.occurredAt, id: last.id })
            : null,
      };
    },
    options.client ?? prisma
  );
}
