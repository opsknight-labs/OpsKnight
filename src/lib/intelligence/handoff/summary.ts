import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { escapeHtml } from '../digest/render';
import { resolveLanguageModel } from '../ai/port';

/**
 * Shift handoff summary: what the incoming on-call responder inherits. Built deterministically from the
 * schedule's services; an AI narrative is added only when a provider cleared for personal data is
 * enabled, and its failure never blocks the summary. Nothing here changes an incident.
 */

export const HANDOFF_RECENT_HOURS = 24;
const MAX_OPEN = 25;
const MAX_RESOLVED = 10;
const MAX_FOLLOWUPS = 10;

export interface HandoffIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  ageMinutes: number;
  assigneeName: string | null;
  acknowledged: boolean;
}

export interface HandoffFollowUp {
  id: string;
  title: string;
  dueAt: Date | null;
  incidentId: string | null;
}

export interface HandoffSummary {
  scheduleName: string;
  generatedAt: Date;
  open: HandoffIncident[];
  recentlyResolved: Array<
    Pick<HandoffIncident, 'id' | 'title' | 'serviceName'> & { resolvedAt: Date }
  >;
  overdueFollowUps: HandoffFollowUp[];
  counts: { open: number; unacknowledged: number; high: number; resolved: number; overdue: number };
  narrative: string | null;
}

export async function buildHandoffSummary(
  input: { scheduleId: string; scheduleName: string; serviceIds: readonly string[]; now?: Date },
  client: typeof prisma = prisma
): Promise<HandoffSummary> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - HANDOFF_RECENT_HOURS * 3_600_000);
  const serviceIds = [...input.serviceIds];
  const empty: HandoffSummary = {
    scheduleName: input.scheduleName,
    generatedAt: now,
    open: [],
    recentlyResolved: [],
    overdueFollowUps: [],
    counts: { open: 0, unacknowledged: 0, high: 0, resolved: 0, overdue: 0 },
    narrative: null,
  };
  if (serviceIds.length === 0) return empty;
  const [open, resolved, followUps, openCount, resolvedCount] = await Promise.all([
    client.incident.findMany({
      where: { serviceId: { in: serviceIds }, status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } },
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
      take: MAX_OPEN,
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        createdAt: true,
        acknowledgedAt: true,
        service: { select: { name: true } },
        assignee: { select: { name: true, email: true } },
      },
    }),
    client.incident.findMany({
      where: { serviceId: { in: serviceIds }, status: 'RESOLVED', resolvedAt: { gte: since } },
      orderBy: { resolvedAt: 'desc' },
      take: MAX_RESOLVED,
      select: { id: true, title: true, resolvedAt: true, service: { select: { name: true } } },
    }),
    client.actionItem.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
        dueDate: { lt: now },
        incident: { serviceId: { in: serviceIds } },
      },
      orderBy: { dueDate: 'asc' },
      take: MAX_FOLLOWUPS,
      select: { id: true, title: true, dueDate: true, incidentId: true },
    }),
    client.incident.count({
      where: { serviceId: { in: serviceIds }, status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED'] } },
    }),
    client.incident.count({
      where: { serviceId: { in: serviceIds }, status: 'RESOLVED', resolvedAt: { gte: since } },
    }),
  ]);
  const openRows: HandoffIncident[] = open.map(incident => ({
    id: incident.id,
    title: incident.title,
    status: incident.status,
    urgency: incident.urgency,
    serviceName: incident.service.name,
    ageMinutes: Math.max(0, Math.round((now.getTime() - incident.createdAt.getTime()) / 60_000)),
    assigneeName: incident.assignee?.name || incident.assignee?.email || null,
    acknowledged: incident.acknowledgedAt !== null,
  }));
  return {
    scheduleName: input.scheduleName,
    generatedAt: now,
    open: openRows,
    recentlyResolved: resolved
      .filter(row => row.resolvedAt)
      .map(row => ({
        id: row.id,
        title: row.title,
        serviceName: row.service.name,
        resolvedAt: row.resolvedAt as Date,
      })),
    overdueFollowUps: followUps.map(item => ({
      id: item.id,
      title: item.title,
      dueAt: item.dueDate,
      incidentId: item.incidentId,
    })),
    counts: {
      open: openCount,
      unacknowledged: openRows.filter(row => !row.acknowledged).length,
      high: openRows.filter(row => row.urgency === 'HIGH').length,
      resolved: resolvedCount,
      overdue: followUps.length,
    },
    narrative: null,
  };
}

const formatAge = (minutes: number) =>
  minutes < 60
    ? `${minutes} min`
    : minutes < 60 * 48
      ? `${Math.round(minutes / 60)} h`
      : `${Math.round(minutes / 1440)} d`;

/** Plain-text and HTML renderings; names and titles are operator data and are escaped in HTML. */
export function renderHandoffSummary(
  summary: HandoffSummary,
  appUrl: string
): { subject: string; html: string; text: string } {
  const { counts } = summary;
  const subject = `Shift handoff for ${summary.scheduleName}: ${counts.open} open${counts.unacknowledged ? `, ${counts.unacknowledged} unacknowledged` : ''}${counts.high ? `, ${counts.high} high urgency` : ''}`;
  const lines: string[] = [];
  const html: string[] = [];
  lines.push(`Shift handoff for ${summary.scheduleName}`);
  lines.push(
    `${counts.open} open incidents (${counts.unacknowledged} unacknowledged, ${counts.high} high urgency), ${counts.resolved} resolved in the last ${HANDOFF_RECENT_HOURS} h, ${counts.overdue} overdue follow-ups.`
  );
  html.push(
    `<h2 style="margin:0 0 8px">Shift handoff for ${escapeHtml(summary.scheduleName)}</h2>`
  );
  html.push(
    `<p>${counts.open} open incidents (${counts.unacknowledged} unacknowledged, ${counts.high} high urgency), ${counts.resolved} resolved in the last ${HANDOFF_RECENT_HOURS} h, ${counts.overdue} overdue follow-ups.</p>`
  );
  if (summary.narrative) {
    lines.push('', summary.narrative);
    html.push(
      `<p style="border-left:3px solid #ccc;padding-left:8px">${escapeHtml(summary.narrative)}</p>`
    );
  }
  const section = (title: string, rows: string[], htmlRows: string[]) => {
    if (rows.length === 0) return;
    lines.push('', `${title}:`, ...rows.map(row => `- ${row}`));
    html.push(
      `<h3 style="margin:16px 0 4px">${escapeHtml(title)}</h3><ul>${htmlRows.join('')}</ul>`
    );
  };
  section(
    'Open incidents',
    summary.open.map(
      row =>
        `[${row.urgency}] ${row.title} (${row.serviceName}, ${row.status.toLowerCase()}, ${formatAge(row.ageMinutes)} old${row.assigneeName ? `, ${row.assigneeName}` : ', unassigned'}) ${appUrl}/incidents/${row.id}`
    ),
    summary.open.map(
      row =>
        `<li><a href="${appUrl}/incidents/${encodeURIComponent(row.id)}">${escapeHtml(row.title)}</a> — ${escapeHtml(row.serviceName)}, ${escapeHtml(row.urgency)} urgency, ${escapeHtml(row.status.toLowerCase())}, ${formatAge(row.ageMinutes)} old${row.assigneeName ? `, ${escapeHtml(row.assigneeName)}` : ', unassigned'}</li>`
    )
  );
  section(
    `Resolved in the last ${HANDOFF_RECENT_HOURS} hours`,
    summary.recentlyResolved.map(
      row => `${row.title} (${row.serviceName}) ${appUrl}/incidents/${row.id}`
    ),
    summary.recentlyResolved.map(
      row =>
        `<li><a href="${appUrl}/incidents/${encodeURIComponent(row.id)}">${escapeHtml(row.title)}</a> — ${escapeHtml(row.serviceName)}</li>`
    )
  );
  section(
    'Overdue follow-ups',
    summary.overdueFollowUps.map(
      row => `${row.title}${row.dueAt ? ` (due ${row.dueAt.toISOString().slice(0, 10)})` : ''}`
    ),
    summary.overdueFollowUps.map(
      row =>
        `<li>${escapeHtml(row.title)}${row.dueAt ? ` — due ${row.dueAt.toISOString().slice(0, 10)}` : ''}</li>`
    )
  );
  lines.push('', `Generated ${summary.generatedAt.toISOString()} by OpsKnight Intelligence.`);
  html.push(
    `<p style="color:#666;font-size:12px">Generated ${summary.generatedAt.toISOString()} by OpsKnight Intelligence.</p>`
  );
  return {
    subject,
    html: `<div style="font-size:14px">${html.join('')}</div>`,
    text: lines.join('\n'),
  };
}

/**
 * Optional AI narrative: three sentences on what matters first. Uses the SUMMARIZE capability with the
 * PERSONAL data class (names of responders appear), charged to the recipient's own AI budget. Any failure
 * or missing provider yields null.
 */
export async function draftHandoffNarrative(
  summary: HandoffSummary,
  recipientUserId: string
): Promise<string | null> {
  try {
    const port = await resolveLanguageModel('SUMMARIZE', 'PERSONAL');
    if (!port) return null;
    const facts = [
      `${summary.counts.open} open incidents, ${summary.counts.unacknowledged} unacknowledged, ${summary.counts.high} high urgency.`,
      ...summary.open
        .slice(0, 10)
        .map(
          row =>
            `Open: ${row.title} on ${row.serviceName}, ${row.urgency} urgency, ${row.status}, ${formatAge(row.ageMinutes)} old, ${row.assigneeName ? 'assigned' : 'unassigned'}.`
        ),
      ...summary.overdueFollowUps.slice(0, 5).map(row => `Overdue follow-up: ${row.title}.`),
    ].join('\n');
    const result = await port.generate({
      context: { actorId: recipientUserId, capability: 'SUMMARIZE', dataClass: 'PERSONAL' },
      messages: [
        {
          role: 'system',
          content:
            'You write a three-sentence shift handoff for an on-call engineer. Use only the facts given. Say what needs attention first and why. Plain text, no lists, no speculation.',
          dataClass: 'PERSONAL',
        },
        { role: 'user', content: facts, dataClass: 'PERSONAL' },
      ],
      maxOutputTokens: 200,
    });
    const text = result.text?.trim();
    return text ? text.slice(0, 800) : null;
  } catch (error) {
    logger.debug('[Intelligence] Handoff narrative unavailable', {
      error: error instanceof Error ? error.name : 'error',
    });
    return null;
  }
}
