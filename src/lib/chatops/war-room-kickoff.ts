import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  getIntelligenceSettings,
  resolveEffectivePolicy,
} from '@/lib/intelligence/settings/service';
import { escapeSlack } from '@/lib/chatops/squire/render';
import { redactSecrets } from '@/lib/intelligence/ai/redact';
import { slackApiCall } from '@/lib/war-room/providers/slack/client';

/**
 * War-room kickoff: one deterministic message when an incident's war room opens, built only from findings the
 * intelligence engine already stored for the incident (similar incidents, likely causes, recommended
 * runbooks). No AI, no new analysis. The channel's audience is not one person (war rooms are public channels),
 * so, as for a stored postmortem draft, other incidents are named only when PUBLIC and sharing a team with this
 * one; changes and runbooks only when unowned or owned by those teams; stored text is redacted. With nothing
 * to say, nothing is posted. Off unless an administrator turns it on.
 */

export const KICKOFF_LIMITS = { similar: 3, causes: 3, runbooks: 3 } as const;

export interface WarRoomKickoff {
  similar: Array<{ id: string; title: string; serviceName: string; fix: string | null }>;
  causes: string[];
  runbooks: Array<{ id: string; name: string }>;
}

type Client = typeof prisma;

const clip = (text: string, max: number) => {
  const value = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

export async function loadWarRoomKickoff(
  incidentId: string,
  client: Client = prisma
): Promise<WarRoomKickoff | null> {
  const settings = await getIntelligenceSettings(client);
  if (!settings.enabled || !settings.warRoomKickoffEnabled) return null;
  const incident = await client.incident.findUnique({
    where: { id: incidentId },
    select: { serviceId: true, teamId: true, service: { select: { teamId: true } } },
  });
  if (!incident) return null;
  const teams = [incident.teamId, incident.service.teamId].filter(
    (team): team is string => team !== null
  );
  const teamService = { service: { teamId: { in: teams } } };
  const policy = await resolveEffectivePolicy(incident.serviceId, client);
  if (policy.effectiveMode !== 'SUGGEST' && policy.effectiveMode !== 'AUTO') return null;
  const kinds = [
    ...(policy.definition.similarity.enabled ? (['SIMILAR_INCIDENT'] as const) : []),
    ...(policy.definition.response.enabled
      ? (['PROBABLE_CAUSE', 'CHANGE_CORRELATION', 'RUNBOOK_RECOMMENDATION'] as const)
      : []),
  ];
  if (kinds.length === 0) return null;
  const findings = await client.intelligenceFinding.findMany({
    where: { incidentId, status: 'ACTIVE', kind: { in: [...kinds] }, subjectRef: { not: null } },
    orderBy: [{ kind: 'asc' }, { rank: 'asc' }],
    take: 40,
    select: { kind: true, subjectRef: true },
  });
  const refs = (kind: string) =>
    findings.filter(finding => finding.kind === kind).map(finding => finding.subjectRef as string);
  const similarIds = refs('SIMILAR_INCIDENT');
  const causeIncidentIds = refs('PROBABLE_CAUSE');
  const changeIds = refs('CHANGE_CORRELATION');
  const runbookIds = refs('RUNBOOK_RECOMMENDATION');

  const [incidents, changes, runbooks] = await Promise.all([
    similarIds.length + causeIncidentIds.length === 0
      ? []
      : client.incident.findMany({
          where: {
            id: { in: [...similarIds, ...causeIncidentIds], not: incidentId },
            visibility: 'PUBLIC',
            OR: [{ teamId: { in: teams } }, teamService],
          },
          select: {
            id: true,
            title: true,
            service: { select: { name: true } },
            intelligenceFingerprint: { select: { resolutionSummary: true } },
          },
        }),
    changeIds.length === 0
      ? []
      : client.changeEvent.findMany({
          where: {
            id: { in: changeIds },
            OR: [{ serviceId: null }, { serviceId: incident.serviceId }, teamService],
          },
          select: { id: true, summary: true, service: { select: { name: true } } },
        }),
    runbookIds.length === 0
      ? []
      : client.runbook.findMany({
          where: {
            id: { in: runbookIds },
            archivedAt: null,
            OR: [
              { ownerTeamId: null },
              { ownerTeamId: { in: teams } },
              { bindings: { some: { OR: [{ serviceId: incident.serviceId }, teamService] } } },
            ],
          },
          select: { id: true, name: true },
        }),
  ]);
  const incidentById = new Map(incidents.map(row => [row.id, row]));
  const changeById = new Map(changes.map(row => [row.id, row]));
  const runbookById = new Map(runbooks.map(row => [row.id, row]));

  const similar = similarIds
    .flatMap(id => incidentById.get(id) ?? [])
    .slice(0, KICKOFF_LIMITS.similar)
    .map(row => ({
      id: row.id,
      title: clip(row.title, 120),
      serviceName: row.service.name,
      fix: row.intelligenceFingerprint?.resolutionSummary
        ? clip(row.intelligenceFingerprint.resolutionSummary, 160)
        : null,
    }));
  const causes = [
    ...changeIds.flatMap(id => {
      const change = changeById.get(id);
      return change
        ? [
            `Change "${clip(change.summary, 120)}"${change.service ? ` on ${change.service.name}` : ''}`,
          ]
        : [];
    }),
    ...causeIncidentIds.flatMap(id => {
      const other = incidentById.get(id);
      return other ? [`Incident "${clip(other.title, 120)}" on ${other.service.name}`] : [];
    }),
  ].slice(0, KICKOFF_LIMITS.causes);
  const recommended = runbookIds
    .flatMap(id => runbookById.get(id) ?? [])
    .slice(0, KICKOFF_LIMITS.runbooks)
    .map(row => ({ id: row.id, name: clip(row.name, 120) }));
  if (similar.length + causes.length + recommended.length === 0) return null;
  return { similar, causes, runbooks: recommended };
}

/** Slack message for a kickoff. Every stored string is escaped, so incident text cannot mention or link. */
export function renderWarRoomKickoff(
  kickoff: WarRoomKickoff,
  baseUrl: string
): { text: string; blocks: Record<string, unknown>[] } {
  const section = (title: string, lines: string[]) =>
    lines.length === 0
      ? []
      : [{ type: 'section', text: { type: 'mrkdwn', text: [`*${title}*`, ...lines].join('\n') } }];
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*What OpsKnight already found for this incident*',
      },
    },
    ...section(
      'Similar past incidents',
      kickoff.similar.map(
        row =>
          `• <${baseUrl}/incidents/${row.id}|${escapeSlack(row.title).replace(/\|/g, '/')}> (${escapeSlack(row.serviceName)})${row.fix ? `\n   Fixed by: ${escapeSlack(row.fix)}` : ''}`
      )
    ),
    ...section(
      'Likely causes',
      kickoff.causes.map(line => `• ${escapeSlack(line)}`)
    ),
    ...section(
      'Recommended runbooks',
      kickoff.runbooks.map(
        row => `• <${baseUrl}/runbooks/${row.id}|${escapeSlack(row.name).replace(/\|/g, '/')}>`
      )
    ),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Suggestions from stored incident analysis. Check them before acting.',
        },
      ],
    },
  ];
  return { text: 'What OpsKnight already found for this incident', blocks };
}

/** Best effort: a failure is logged and never fails war-room provisioning. */
export async function postWarRoomKickoff(input: {
  incidentId: string;
  channelId: string;
  botToken: string;
  baseUrl: string;
}): Promise<boolean> {
  try {
    const kickoff = await loadWarRoomKickoff(input.incidentId);
    if (!kickoff) return false;
    const message = renderWarRoomKickoff(kickoff, input.baseUrl.replace(/\/+$/, ''));
    const result = await slackApiCall('chat.postMessage', input.botToken, {
      channel: input.channelId,
      ...message,
      unfurl_links: false,
      unfurl_media: false,
    });
    return result.ok;
  } catch (error) {
    logger.warn('[ChatOps] War-room kickoff not posted', {
      incidentId: input.incidentId,
      error: error instanceof Error ? error.name : 'error',
    });
    return false;
  }
}
