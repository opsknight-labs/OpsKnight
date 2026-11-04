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

const MAX_SUMMARY_FIELDS = 4;
const MAX_SUMMARY_VALUE = 80;

/** Simple top-level fields (errors, names, counts) for events without a tailored sentence. */
function detailSummary(details: Details): string {
  if (!details) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === 'operationalImpact') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value);
      parts.push(
        `${key}: ${text.length > MAX_SUMMARY_VALUE ? `${text.slice(0, MAX_SUMMARY_VALUE)}…` : text}`
      );
    } else if (Array.isArray(value)) {
      parts.push(`${key}: ${plural(value.length, 'item')}`);
    }
    if (parts.length === MAX_SUMMARY_FIELDS) break;
  }
  return parts.join(' · ');
}

export function describeScimEvent(
  action: string,
  details: Details,
  subjectName: string | null,
  resourceId: string | null = null
): { label: string; detail: string; attention: boolean } {
  const label = labels.get(action) ?? action;
  const who = subjectName ? `${subjectName}. ` : '';
  const impact = impactSentence(details);
  if (impact) return { label, detail: `${who}${impact.sentence}`, attention: impact.attention };
  const detail = [subjectName ?? resourceId, detailSummary(details)].filter(Boolean).join(' · ');
  return { label, detail, attention: false };
}
