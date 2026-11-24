import 'server-only';
import prisma from '@/lib/prisma';
import { dashboardUserReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { redactSecrets } from '../../ai/redact';
import type { EvidenceSnapshot } from '../evidence';

/* eslint-disable security/detect-unsafe-regex -- fixed patterns with bounded quantifiers over a capped message */
const LIST_TEAMS =
  /^(?:please )?(?:(?:list|show)(?: me)?(?: all)?(?: the)? teams|(?:what|which) teams (?:are there|exist|do we have|can i see)|all teams|teams)[\s?!.]*$/;
/** "Who is on the Platform team", "members of the payments team", "who is in this team". */
const TEAM_MEMBERS =
  /\b(?:who(?: is| are)?|members?|people|list(?: the)? members|show(?: the)? members)\s+(?:is |are )?(?:on|in|of)\s+(?:the\s+)?([a-z0-9][\w .&-]{0,60}?)\s+team\b/;
/* eslint-enable security/detect-unsafe-regex */

const clean = (value: string | null | undefined) =>
  redactSecrets(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/**
 * Team listing and membership, under the person's own visibility: teams they may read, and only the
 * members they may see. Null when the question is not about teams.
 */
export async function teamsAnswer(
  actor: AuthorizationActor,
  text: string,
  pageTeamId: string | null,
  collect?: (source: EvidenceSnapshot) => void
): Promise<string | null> {
  if (LIST_TEAMS.test(text)) {
    const where = teamReadWhere(actor);
    const [total, rows] = await Promise.all([
      prisma.team.count({ where }),
      prisma.team.findMany({
        where,
        orderBy: { name: 'asc' },
        take: 20,
        select: { id: true, name: true, _count: { select: { members: true } } },
      }),
    ]);
    return [
      '## Teams you can view',
      `${total} team${total === 1 ? '' : 's'}${total > rows.length ? `; showing the first ${rows.length}` : ''}.`,
      rows
        .map(
          row =>
            `- **${clean(row.name)}** — ${row._count.members} member${row._count.members === 1 ? '' : 's'}. /teams/${row.id}`
        )
        .join('\n') || 'No teams are visible to you.',
      'Ask “who is on the <name> team” for its members.',
    ].join('\n\n');
  }
  const name = text.match(TEAM_MEMBERS)?.[1]?.trim();
  if (!name) return null;
  const here = /^(?:this|that|current)$/.test(name);
  if (here && !pageTeamId) return 'Which team? Name it, for example “who is on the Platform team”.';
  const teams = await prisma.team.findMany({
    where: {
      AND: [
        teamReadWhere(actor),
        here ? { id: pageTeamId! } : { name: { contains: name, mode: 'insensitive' as const } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 6,
    select: { id: true, name: true },
  });
  const team =
    teams.length === 1
      ? teams[0]
      : teams.find(row => row.name.toLowerCase() === name.toLowerCase());
  if (!team)
    return teams.length
      ? `Several teams match “${clean(name)}”:\n${teams.map(row => `- ${clean(row.name)} — /teams/${row.id}`).join('\n')}\nAsk again with the full name.`
      : `No team called “${clean(name)}” is visible to you. Ask “list teams” to see the ones you can view.`;
  const members = await prisma.teamMember.findMany({
    where: {
      teamId: team.id,
      user: { AND: [{ status: 'ACTIVE' }, dashboardUserReadWhere(actor)] },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    take: 26,
    select: { role: true, user: { select: { id: true, name: true, updatedAt: true } } },
  });
  members
    .slice(0, 25)
    .forEach(row =>
      collect?.({ kind: 'person', id: row.user.id, label: row.user.name, data: row.user })
    );
  return [
    `## ${clean(team.name)} team`,
    members.length
      ? members
          .slice(0, 25)
          .map(
            row =>
              `- ${clean(row.user.name) || 'Unnamed member'}${row.role === 'MEMBER' ? '' : ` (${row.role.toLowerCase()})`}`
          )
          .join('\n')
      : 'No members of this team are visible to you.',
    members.length > 25 ? 'Showing the first 25 members; open the team for the full list.' : '',
    `/teams/${team.id}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
