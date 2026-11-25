import type { BusinessServiceFormValue } from './BusinessServiceForm';

type TemplateDefaults = {
  description: string | null;
  criticality: BusinessServiceFormValue['criticality'] | null;
  sloTarget: number | null;
  sloWindowDays: number;
  quorumPartialPct: number | null;
  quorumMajorPct: number | null;
  tags: readonly string[];
  environment: string | null;
  lifecycle: BusinessServiceFormValue['lifecycle'];
  impactMinUrgency: BusinessServiceFormValue['impactMinUrgency'] | null;
  impactMaxPriority: string | null;
  ownerTeamId: string | null;
  linksText: string;
};

/** The new-business-service form pre-filled from a template; the person still names and saves it. */
export function formValueFromTemplate(template: TemplateDefaults): BusinessServiceFormValue {
  return {
    name: '',
    description: template.description ?? '',
    statusPageSummary: '',
    linksText: template.linksText,
    tier: '',
    ownerTeamId: template.ownerTeamId ?? '',
    memberServiceIds: [],
    followerUserIds: [],
    criticality: template.criticality ?? '',
    impactMinUrgency: template.impactMinUrgency ?? '',
    impactMaxPriority: template.impactMaxPriority ?? '',
    nonCriticalServiceIds: [],
    dependsOnBusinessServiceIds: [],
    teamSubscriberIds: [],
    ownerUserId: '',
    escalationPolicyId: '',
    contactChannel: '',
    environment: template.environment ?? '',
    lifecycle: template.lifecycle,
    tagsText: template.tags.join(', '),
    attributesText: '',
    markReviewed: false,
    sloTarget: template.sloTarget === null ? '' : String(template.sloTarget),
    sloWindowDays: String(template.sloWindowDays) as '7' | '30' | '90',
    quorumPartialPct: template.quorumPartialPct === null ? '' : String(template.quorumPartialPct),
    quorumMajorPct: template.quorumMajorPct === null ? '' : String(template.quorumMajorPct),
    dependencyHopDepth: '3',
  };
}
