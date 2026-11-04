/**
 * Turns SCIM activity records into sentences an administrator can act on, instead of raw
 * JSON. Offboarding that leaves on-call coverage gaps is flagged for attention.
 */
type Details = Record<string, unknown> | null | undefined;

const LABELS: Record<string, string> = {
  'connector.created': 'Connection created',
  'connector.updated': 'Connection updated',
  'credential.created': 'Credential created',
  'credential.revoked': 'Credential revoked',
  'user.created': 'Person provisioned',
  'user.updated': 'Person updated',
  'user.disabled': 'Person deactivated',
  'user.reactivated': 'Person reactivated',
  'user.deleted': 'Person removed by the directory',
  'user.binding.approved': 'Existing account connected',
  'user.restoration.approved': 'Rehire restoration approved',
  'group.created': 'Group created',
  'group.updated': 'Group updated',
  'group.deleted': 'Group deleted',
  'binding.approved': 'Group linked to a team',
  'binding.detached': 'Group unlinked from a team',
};
const labels = new Map(Object.entries(LABELS));

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function impactSentence(details: Details): { sentence: string; attention: boolean } | null {
  const impact = details?.operationalImpact;
  if (!impact || typeof impact !== 'object') return null;
  const value = impact as Record<string, unknown>;
  const shifts = Number(value.futureShifts ?? 0);
  const rules = Number(value.directEscalationRules ?? 0);
  const uncovered = Number(value.teamsWithoutActiveResponders ?? 0);
  const teams = Number(value.teamCount ?? 0);
  const parts: string[] = [];
  if (shifts) parts.push(`${plural(shifts, 'upcoming on-call shift')} need a new owner`);
  if (rules)
    parts.push(
      `${plural(rules, 'escalation rule')} ${rules === 1 ? 'pages' : 'page'} them directly`
    );
  if (uncovered)
    parts.push(
      `${plural(uncovered, 'team')} now ${uncovered === 1 ? 'has' : 'have'} no active responder`
    );
  if (!parts.length)
    return teams
      ? { sentence: `Still listed on ${plural(teams, 'team')}; no on-call gaps.`, attention: false }
      : null;
  return { sentence: `Review coverage: ${parts.join(', ')}.`, attention: true };
}

export function describeScimEvent(
  action: string,
  details: Details,
  subjectName: string | null
): { label: string; detail: string; attention: boolean } {
  const label = labels.get(action) ?? action;
  const who = subjectName ? `${subjectName}. ` : '';
  const impact = impactSentence(details);
  if (impact) return { label, detail: `${who}${impact.sentence}`, attention: impact.attention };
  return { label, detail: subjectName ?? '', attention: false };
}
