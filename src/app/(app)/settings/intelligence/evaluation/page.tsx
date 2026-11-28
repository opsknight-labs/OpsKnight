import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import {
  INTELLIGENCE_SETTINGS_GROUPS,
  type RouteSearchParams,
} from '@/lib/intelligence/settings/routes';
import AiUsageSpendSections from '../_sections/AiUsageSpendSections';
import GroupingQualitySection from '../_sections/GroupingQualitySection';
import InsightsSections from '../_sections/InsightsSections';
import { requirePageAccess } from '@/lib/access/server';
import MovedSectionRedirect from '@/components/settings/MovedSectionRedirect';
import { ViewOnlyNotice } from '@/components/settings/form-kit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Sections only managers see: proposals that publish a policy version. */
const MANAGER_ONLY = new Set(['learned-weights']);

/**
 * Evaluation & spend: how good grouping, suggestions and answers are, what the history says, and
 * what AI costs. Formerly three pages (Quality, Insights and the usage half of Assistant & AI).
 * The sections are sibling server components, so they load side by side and each one degrades on
 * its own.
 */
export default async function IntelligenceEvaluationPage({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/evaluation');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const params = await searchParams;
  const spendDays = params?.spend === '30' ? 30 : 7;
  const visible = INTELLIGENCE_SETTINGS_GROUPS.find(group => group.id === 'evaluation')!
    .sections.map(section => section.id)
    .filter(id => canManage || !MANAGER_ONLY.has(id));

  return (
    <div className="space-y-6">
      <MovedSectionRedirect group="evaluation" />
      <IntelligenceGroupHeader
        group="evaluation"
        visible={visible}
        about={
          <p>
            Grouping decisions are measured against human reviews, assistant answers against their
            ratings, and the incident history for repeated problems, next to what AI usage costs.
            Nothing here changes behaviour on its own; a proposed weight or threshold is published
            only when you choose to.
          </p>
        }
      >
        Measure suggestions and answers before you trust them, and see what AI costs.
      </IntelligenceGroupHeader>
      {!canManage && <ViewOnlyNotice what="Intelligence settings" />}

      <GroupingQualitySection
        params={{ serviceId: params?.serviceId, q: params?.q, after: params?.after }}
      />
      <InsightsSections canManage={canManage} />
      <AiUsageSpendSections canManage={canManage} spendDays={spendDays} />
    </div>
  );
}
