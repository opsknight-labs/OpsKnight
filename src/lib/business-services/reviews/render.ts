import { createElement } from 'react';
import { renderEmail } from '@/emails/render';
import {
  ServiceReviewEmail,
  type ServiceReviewEmailProps,
} from '@/emails/templates/service-review';
import { formatMinutes, formatMoney, type Digest, type DigestEntry } from './digest';

const COMPACT_CAP = 40;

const pct = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(2)}%`);

function budgetText(e: DigestEntry) {
  return e.budget ? `${Math.round(e.budget.remainingPercent)}% remaining` : 'No SLO set';
}

function compactSummary(e: DigestEntry) {
  const state =
    e.burnState === 'BREACHED' ? 'Budget exhausted' : e.burnState === 'AT_RISK' ? 'At risk' : 'OK';
  return `${state}, ${e.incidentCount} incident${e.incidentCount === 1 ? '' : 's'}, ${formatMinutes(e.downtimeMinutes)} downtime`;
}

export function toEmailProps(
  digest: Digest,
  ctx: Pick<
    ServiceReviewEmailProps,
    'recipientName' | 'periodLabel' | 'kind' | 'reviewUrl' | 'manageUrl' | 'preview'
  >
): ServiceReviewEmailProps {
  const t = digest.totals;
  return {
    ...ctx,
    totals: {
      services: String(t.services),
      breached: String(t.breached),
      atRisk: String(t.atRisk),
      incidents: String(t.incidents),
      downtime: formatMinutes(t.downtimeMinutes),
      cost: formatMoney(t.estimatedCostCents, t.currency),
    },
    expanded: digest.expanded.map(e => ({
      name: e.name,
      state: e.burnState,
      slo:
        e.sloTarget === null
          ? 'No SLO set'
          : `${pct(e.attainmentPercent)} vs ${e.sloTarget}% target`,
      budget: budgetText(e),
      trend: e.trend === 'unknown' ? 'no prior month' : e.trend,
      downtime: formatMinutes(e.downtimeMinutes),
      incidents: String(e.incidentCount),
      response: `${e.mttaMinutes === null ? 'n/a' : formatMinutes(e.mttaMinutes)} / ${e.mttrMinutes === null ? 'n/a' : formatMinutes(e.mttrMinutes)}`,
      cost: formatMoney(e.estimatedCostCents, e.currency),
      causes: e.topCauses,
    })),
    compact: digest.compact
      .slice(0, COMPACT_CAP)
      .map(e => ({ name: e.name, summary: compactSummary(e) })),
    hiddenCount: Math.max(0, digest.compact.length - COMPACT_CAP),
  };
}

export async function renderReview(props: ServiceReviewEmailProps) {
  const { html, text } = await renderEmail(createElement(ServiceReviewEmail, props));
  const t = props.totals;
  const subject = `${props.kind === 'summary' ? 'Portfolio review' : 'Service review'} ${props.periodLabel}: ${t.breached} over budget, ${t.atRisk} at risk`;
  return { html, text, subject };
}
