import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../ai/redact';
import { withDbBudget } from '../jobs/db-budget';
import { resolveOverviewWindow } from '../overview/window';
import {
  classifyAlertDecision,
  encodeListCursor,
  LIST_PAGE_SIZE,
  LIST_SERVICE_OPTION_LIMIT,
  type AlertDecisionKind,
  type AlertDecisionLabelKind,
  type AlertListFilters,
  type ListCursor,
} from './contract';

/** Statement budget for one list page; a slow page fails on its own and the page says so. */
export const LIST_DB_BUDGET = { maxDbMs: 4000 };
const MAX_LABELS = 4;
/** A decision is recorded in the same transaction as its alert; the slack covers clock and commit skew. */
const DECISION_SKEW_MS = 5 * 60_000;

export interface AlertListDecision {
  kind: AlertDecisionLabelKind;
  /** False for a shadow decision: recorded as what would have happened, the alert was not affected. */
  applied: boolean;
  sourceName: string | null;
  reason: string;
}

export interface AlertListRow {
  id: string;
  summary: string;
  serviceId: string;
  serviceName: string;
  severity: string | null;
  status: string;
  labels: Array<{ key: string; value: string }>;
  /** Labels on the alert beyond the ones shown. */
  moreLabels: number;
  receivedAt: Date;
  incidentId: string | null;
  decision: AlertListDecision | null;
}

export interface ListServiceOption {
  id: string;
  name: string;
}

export interface AlertListPage {
  rows: AlertListRow[];
  /** Cursor for the next page, or null on the last one. */
  nextCursor: string | null;
  services: ListServiceOption[];
  servicesTruncated: boolean;
}

type Client = typeof prisma;
type Tx = Prisma.TransactionClient;

/**
 * What the actor may read: alerts of readable services whose incident, when there is one, is readable
 * too. Null when the actor may read no services at all.
 */
export function alertReadWhere(actor: AuthorizationActor): Prisma.AlertWhereInput | null {
  let service: Prisma.ServiceWhereInput;
  let incident: Prisma.IncidentWhereInput;
  try {
    service = serviceReadWhere(actor);
    incident = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const and: Prisma.AlertWhereInput[] = [];
  if (Object.keys(service).length > 0) and.push({ service });
  if (Object.keys(incident).length > 0) and.push({ OR: [{ incidentId: null }, { incident }] });
  return { AND: and };
}

const keysetBefore = (cursor: ListCursor | null) =>
  cursor
    ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
    : {};

const CLASSIFIED_CONTROLS = ['MAINTENANCE', 'CONTENT_DEDUP', 'STORM'] as const;

/** The stored decisions each filter value stands for; the inverse of classifyAlertDecision. */
function decisionKindWhere(kind: AlertDecisionKind): Prisma.PrePagingDecisionWhereInput {
  const other = { control: { notIn: [...CLASSIFIED_CONTROLS] } };
  switch (kind) {
    case 'maintenance':
      return { control: 'MAINTENANCE' };
    case 'deduped':
      return { OR: [{ control: 'CONTENT_DEDUP' }, { ...other, action: 'APPEND' }] };
    case 'grouped':
      return { OR: [{ control: 'STORM' }, { ...other, action: 'GROUP_CHILD' }] };
    case 'suppressed':
      return { ...other, action: { in: ['SUPPRESS', 'DROP'] } };
  }
}

const ALERT_SELECT = {
  id: true,
  payload: true,
  dedupKey: true,
  serviceId: true,
  severity: true,
  status: true,
  labels: true,
  createdAt: true,
  incidentId: true,
  service: { select: { name: true } },
} satisfies Prisma.AlertSelect;
type AlertRecord = Prisma.AlertGetPayload<{ select: typeof ALERT_SELECT }>;

const DECISION_SELECT = {
  id: true,
  alertId: true,
  control: true,
  action: true,
  applied: true,
  sourceName: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.PrePagingDecisionSelect;
type DecisionRecord = Prisma.PrePagingDecisionGetPayload<{ select: typeof DECISION_SELECT }>;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function alertSummary(alert: AlertRecord): string {
  const payload =
    alert.payload && typeof alert.payload === 'object' && !Array.isArray(alert.payload)
      ? (alert.payload as Record<string, unknown>)
      : {};
  const text =
    typeof payload.summary === 'string' && payload.summary.trim()
      ? payload.summary
      : typeof payload.title === 'string' && payload.title.trim()
        ? payload.title
        : (alert.dedupKey ?? 'Alert');
  return clip(redactSecrets(text.trim()), 300);
}

function alertLabels(value: unknown): Pick<AlertListRow, 'labels' | 'moreLabels'> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { labels: [], moreLabels: 0 };
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string | number | boolean] =>
      ['string', 'number', 'boolean'].includes(typeof entry[1])
  );
  return {
    labels: entries.slice(0, MAX_LABELS).map(([key, raw]) => ({
      key: clip(key, 40),
      value: clip(redactSecrets(String(raw)), 80),
    })),
    moreLabels: Math.max(0, entries.length - MAX_LABELS),
  };
}

function toDecision(decision: DecisionRecord): AlertListDecision | null {
  const kind = classifyAlertDecision(decision.control, decision.action);
  if (!kind) return null;
  return {
    kind,
    applied: decision.applied,
    sourceName: decision.sourceName,
    reason: clip(redactSecrets(decision.reason), 200),
  };
}

function toRow(alert: AlertRecord, decision: AlertListDecision | null): AlertListRow {
  return {
    id: alert.id,
    summary: alertSummary(alert),
    serviceId: alert.serviceId,
    serviceName: alert.service.name,
    severity: alert.severity,
    status: alert.status,
    ...alertLabels(alert.labels),
    receivedAt: alert.createdAt,
    incidentId: alert.incidentId,
    decision,
  };
}

/** Decisions for one page of alerts, read through PrePagingDecision(serviceId, createdAt). */
async function decisionsFor(
  tx: Tx,
  alerts: readonly AlertRecord[]
): Promise<Map<string, AlertListDecision>> {
  const out = new Map<string, AlertListDecision>();
  if (alerts.length === 0) return out;
  const times = alerts.map(alert => alert.createdAt.getTime());
  const decisions = await tx.prePagingDecision.findMany({
    where: {
      serviceId: { in: [...new Set(alerts.map(alert => alert.serviceId))] },
      createdAt: {
        gte: new Date(Math.min(...times) - DECISION_SKEW_MS),
        lte: new Date(Math.max(...times) + DECISION_SKEW_MS),
      },
      alertId: { in: alerts.map(alert => alert.id) },
      reversedAt: null,
      action: { not: 'NONE' },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: alerts.length * 4,
    select: DECISION_SELECT,
  });
  for (const decision of decisions) {
    if (!decision.alertId) continue;
    const view = toDecision(decision);
    if (!view) continue;
    const current = out.get(decision.alertId);
    // An applied decision is what actually happened; a shadow one is shown only when nothing applied.
    if (!current || (!current.applied && view.applied)) out.set(decision.alertId, view);
  }
  return out;
}

async function serviceOptions(
  tx: Tx,
  actor: AuthorizationActor
): Promise<Pick<AlertListPage, 'services' | 'servicesTruncated'>> {
  let where: Prisma.ServiceWhereInput;
  try {
    where = serviceReadWhere(actor);
  } catch {
    return { services: [], servicesTruncated: false };
  }
  const services = await tx.service.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: LIST_SERVICE_OPTION_LIMIT + 1,
    select: { id: true, name: true },
  });
  return {
    services: services.slice(0, LIST_SERVICE_OPTION_LIMIT),
    servicesTruncated: services.length > LIST_SERVICE_OPTION_LIMIT,
  };
}

export { serviceOptions as listReadableServiceOptions };

/**
 * One page of alerts the actor may read, newest first, with the noise decision recorded for each.
 *
 * Without a decision filter the page is a keyset walk of Alert(createdAt) (or (serviceId, createdAt))
 * inside the selected window. With one, the walk runs over PrePagingDecision(createdAt) instead, since
 * that is where the decision lives, and the alerts are then read by primary key; rows the actor may not
 * read, or that a severity filter excludes, drop out, so such a page can be shorter than the page size.
 */
export async function listAlertsForActor(
  actor: AuthorizationActor,
  filters: AlertListFilters,
  options: { client?: Client; now?: Date; pageSize?: number } = {}
): Promise<AlertListPage> {
  const empty: AlertListPage = {
    rows: [],
    nextCursor: null,
    services: [],
    servicesTruncated: false,
  };
  const readable = alertReadWhere(actor);
  if (!readable) return empty;
  const pageSize = Math.min(Math.max(options.pageSize ?? LIST_PAGE_SIZE, 1), LIST_PAGE_SIZE);
  const { since, until } = resolveOverviewWindow(filters.window, options.now);
  const shared: Prisma.AlertWhereInput[] = [
    readable,
    ...(filters.serviceId ? [{ serviceId: filters.serviceId }] : []),
    ...(filters.severity ? [{ severity: filters.severity }] : []),
  ];

  return withDbBudget(
    LIST_DB_BUDGET,
    async tx => {
      const filterOptions = await serviceOptions(tx, actor);
      if (!filters.decision) {
        const alerts = await tx.alert.findMany({
          where: {
            AND: [
              ...shared,
              { createdAt: { gte: since, lt: until } },
              keysetBefore(filters.cursor),
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: pageSize + 1,
          select: ALERT_SELECT,
        });
        const page = alerts.slice(0, pageSize);
        const decisions = await decisionsFor(tx, page);
        const last = page[page.length - 1];
        return {
          ...filterOptions,
          rows: page.map(alert => toRow(alert, decisions.get(alert.id) ?? null)),
          nextCursor:
            alerts.length > pageSize && last
              ? encodeListCursor({ at: last.createdAt, id: last.id })
              : null,
        };
      }

      let serviceScope: Prisma.ServiceWhereInput;
      try {
        serviceScope = serviceReadWhere(actor);
      } catch {
        return { ...empty, ...filterOptions };
      }
      const decisions = await tx.prePagingDecision.findMany({
        where: {
          AND: [
            decisionKindWhere(filters.decision),
            { alertId: { not: null }, reversedAt: null, action: { not: 'NONE' } },
            { createdAt: { gte: since, lt: until } },
            keysetBefore(filters.cursor),
            filters.serviceId ? { serviceId: filters.serviceId } : {},
            Object.keys(serviceScope).length > 0 ? { service: serviceScope } : {},
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: DECISION_SELECT,
      });
      const page = decisions.slice(0, pageSize);
      const alertIds = [...new Set(page.map(decision => decision.alertId as string))];
      const alerts = alertIds.length
        ? await tx.alert.findMany({
            where: { AND: [...shared, { id: { in: alertIds } }] },
            select: ALERT_SELECT,
          })
        : [];
      const byId = new Map(alerts.map(alert => [alert.id, alert]));
      const seen = new Set<string>();
      const rows: AlertListRow[] = [];
      for (const decision of page) {
        const alert = byId.get(decision.alertId as string);
        if (!alert || seen.has(alert.id)) continue;
        seen.add(alert.id);
        rows.push(toRow(alert, toDecision(decision)));
      }
      const last = page[page.length - 1];
      return {
        ...filterOptions,
        rows,
        nextCursor:
          decisions.length > pageSize && last
            ? encodeListCursor({ at: last.createdAt, id: last.id })
            : null,
      };
    },
    options.client ?? prisma
  );
}

/**
 * One alert as the list shows it, for the detail page of an alert that never opened an incident (for
 * example one a suppression rule held back). Null when the actor may not read it.
 */
export async function getListedAlert(
  actor: AuthorizationActor,
  id: string,
  client: Client = prisma
): Promise<AlertListRow | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ)) return null;
  const readable = alertReadWhere(actor);
  if (!readable) return null;
  const alert = await client.alert.findFirst({
    where: { AND: [readable, { id }] },
    select: ALERT_SELECT,
  });
  if (!alert) return null;
  const decisions = await decisionsFor(client, [alert]);
  return toRow(alert, decisions.get(alert.id) ?? null);
}
