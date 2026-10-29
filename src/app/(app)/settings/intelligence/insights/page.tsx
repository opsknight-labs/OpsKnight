import Link from 'next/link';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  ApplySuggestionForm,
  DigestSettingsForm,
  RuleSuggestionsPanel,
  SendTestDigestButton,
  ScoringWeightsForm,
} from '@/components/settings/InsightsForms';
import { Badge } from '@/components/ui/shadcn/badge';
import { logger } from '@/lib/logger';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { MIN_FEEDBACK_FOR_SUGGESTION } from '@/lib/intelligence/insights/calibration';
import {
  getInsights,
  RECURRING_MIN_OCCURRENCES,
  RECURRING_WINDOW_DAYS,
} from '@/lib/intelligence/insights/service';
import { listPolicyVersions, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { getDigestSettings, getLatestDigestRun } from '@/lib/intelligence/digest/service';
import { suggestScoringWeights } from '@/lib/intelligence/learning/weights-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function load() {
  try {
    const actor = await getCurrentAuthorizationActor();
    const [insights, versions, digest, lastRun, policy, scoring] = await Promise.all([
      getInsights(actor),
      listPolicyVersions({}, { limit: 1 }),
      getDigestSettings(),
      getLatestDigestRun(),
      resolveEffectivePolicy(null),
      hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)
        ? suggestScoringWeights()
        : Promise.resolve(null),
    ]);
    return {
      insights,
      headVersion: versions.headVersion,
      digest,
      lastRun,
      mode: policy.mode,
      scoring,
    };
  } catch (error) {
    logger.warn('[Intelligence] Insights could not load', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default async function IntelligenceInsightsPage() {
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const loaded = await load();
  const insights = loaded?.insights ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-muted-foreground">
          What the incident history says about repeated problems and how useful the suggestions are.
          Flags only: nothing is changed, muted or paged, and any suggested change is applied only
          when you choose to.
        </p>
      </header>

      {!insights ? (
        <p className="text-sm text-muted-foreground">Unavailable.</p>
      ) : (
        <>
          {insights.weekly && (
            <SettingsSection title="Last 7 days" description="Counts across all services.">
              <div className="grid gap-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Incidents analyzed', insights.weekly.incidentsAnalyzed],
                  ['Similar incidents found', insights.weekly.findingsByKind.SIMILAR_INCIDENT ?? 0],
                  [
                    'Possible causes found',
                    (insights.weekly.findingsByKind.CHANGE_CORRELATION ?? 0) +
                      (insights.weekly.findingsByKind.PROBABLE_CAUSE ?? 0),
                  ],
                  [
                    'Runbooks suggested',
                    insights.weekly.findingsByKind.RUNBOOK_RECOMMENDATION ?? 0,
                  ],
                  ['Ratings received', insights.weekly.ratings],
                  [
                    'Rated helpful',
                    insights.weekly.ratings === 0
                      ? '–'
                      : `${Math.round((insights.weekly.helpfulRatings / insights.weekly.ratings) * 100)}%`,
                  ],
                  ['Changes recorded', insights.weekly.changesRecorded],
                  ['Stuck work items', insights.weekly.deadLetters],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold">{value}</p>
                  </div>
                ))}
              </div>
            </SettingsSection>
          )}

          <SettingsSection
            title="Recurring problems"
            description={`The same masked incident title at least ${RECURRING_MIN_OCCURRENCES} times on at least 2 days in the last ${RECURRING_WINDOW_DAYS} days.`}
          >
            {insights.recurring.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No recurring problems found.</p>
            ) : (
              <ul className="divide-y divide-border">
                {insights.recurring.map(item => (
                  <li
                    key={`${item.serviceId}:${item.template}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/incidents/${item.latestIncidentId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {item.template}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {item.serviceName} · {item.occurrences} times over {item.distinctDays} days
                        · last {item.lastSeenAt.toISOString().slice(0, 10)}
                      </p>
                    </div>
                    {!item.hasRunbook && <Badge variant="secondary">No runbook attached</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection
            title="Unusual volume"
            description="Robust comparisons with prior weeks and the same weekday and hour in UTC. Regular seasonal spikes are part of the baseline."
          >
            {insights.anomalies.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">Nothing unusual.</p>
            ) : (
              <ul className="divide-y divide-border">
                {insights.anomalies.map(item => (
                  <li
                    key={item.serviceId}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.serviceName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.recent} incidents this week vs about {item.baselineWeekly} per week
                        before
                      </p>
                    </div>
                    <Badge variant="outline">{item.ratio}× normal</Badge>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>

          <SettingsSection
            title="Flapping alerts"
            description="Repeated short-lived incidents for the same service and alert key within the last day."
          >
            {insights.flapping.length ? (
              <ul className="divide-y divide-border">
                {insights.flapping.map(item => (
                  <li key={item.incidentId} className="py-3 text-sm">
                    <Link
                      href={`/incidents/${item.incidentId}`}
                      className="font-medium hover:underline"
                    >
                      {item.serviceName}
                    </Link>
                    <span className="text-muted-foreground">
                      {' '}
                      · {item.episodes} short resolved episodes
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                No flapping alert patterns found.
              </p>
            )}
          </SettingsSection>

          {canManage && loaded && (
            <SettingsSection
              title="Scoring weights"
              description="Offline proposals from responder feedback. Publishing creates an audited policy version; proposals never apply themselves."
            >
              {loaded.scoring ? (
                <div className="space-y-3 py-3">
                  <p className="text-sm">
                    {loaded.scoring.support} labelled pairs. Held-out loss{' '}
                    {loaded.scoring.heldOutLoss.toFixed(3)} versus{' '}
                    {loaded.scoring.baselineLoss.toFixed(3)} with default weights.
                  </p>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(loaded.scoring.weights).map(([name, weight]) => (
                      <div key={name}>
                        <dt className="text-muted-foreground">{name}</dt>
                        <dd>{(weight * 100).toFixed(1)}%</dd>
                      </div>
                    ))}
                  </dl>
                  <ScoringWeightsForm
                    suggestionId={loaded.scoring.id}
                    expectedHeadVersion={loaded.headVersion}
                  />
                </div>
              ) : (
                <p className="py-3 text-sm text-muted-foreground">
                  No supported improvement yet. A proposal needs at least 50 labelled pairs,
                  positive and negative feedback, and better results on held-out examples.
                </p>
              )}
            </SettingsSection>
          )}

          {insights.calibration && (
            <SettingsSection
              title="Suggestion quality"
              description="How responders rated similar-incident suggestions, by match score."
            >
              <div className="space-y-4 py-3">
                <p className="text-sm">
                  {insights.calibration.votes === 0
                    ? 'No ratings yet.'
                    : `${insights.calibration.helpful} of ${insights.calibration.votes} ratings were helpful.`}
                </p>
                {insights.calibration.buckets.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {insights.calibration.buckets.map(bucket => {
                      const total = bucket.helpful + bucket.notHelpful;
                      return (
                        <li key={bucket.from} className="flex justify-between gap-4">
                          <span>
                            Score {bucket.from.toFixed(1)}–{bucket.to.toFixed(1)}
                          </span>
                          <span className="text-muted-foreground">
                            {Math.round((bucket.helpful / total) * 100)}% helpful ({total})
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {insights.calibration.suggestion ? (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-sm">
                      Suggestions scoring below {insights.calibration.suggestion.suggested} are
                      mostly unhelpful. Raising the minimum similarity from{' '}
                      {insights.calibration.suggestion.current} to{' '}
                      {insights.calibration.suggestion.suggested} keeps{' '}
                      {insights.calibration.suggestion.votes} rated suggestions (
                      {Math.round(insights.calibration.suggestion.helpfulRate * 100)}% helpful) and
                      hides {insights.calibration.suggestion.hiddenVotes}.
                    </p>
                    {canManage && loaded && (
                      <ApplySuggestionForm
                        suggested={insights.calibration.suggestion.suggested}
                        expectedHeadVersion={loaded.headVersion}
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A threshold suggestion needs at least {MIN_FEEDBACK_FOR_SUGGESTION} ratings and
                    a clear pattern. None right now.
                  </p>
                )}
              </div>
            </SettingsSection>
          )}

          {canManage && loaded && (
            <SettingsSection
              title="Suggested grouping rules"
              description="Grouping rules learned from the links responders confirmed and the suggestions they rejected, checked against recent history before they are offered."
            >
              <RuleSuggestionsPanel expectedHeadVersion={loaded.headVersion} mode={loaded.mode} />
            </SettingsSection>
          )}

          {insights.weekly && loaded && (
            <div id="digest" className="scroll-mt-24">
              <SettingsSection
                title="Weekly digest"
                description="A short email with these numbers, recurring problems and unusual volume. Off by default; it never changes anything."
                action={
                  <Badge variant={loaded.digest.enabled ? 'default' : 'secondary'}>
                    {loaded.digest.enabled ? 'On' : 'Off'}
                  </Badge>
                }
              >
                <DigestSettingsForm settings={loaded.digest} canManage={canManage} />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
                  <p className="text-xs text-muted-foreground">
                    {loaded.lastRun
                      ? `Last digest ${loaded.lastRun.weekKey}: ${loaded.lastRun.status === 'COMPLETED' ? 'sent' : 'sending'} to ${loaded.lastRun.sent} ${loaded.lastRun.sent === 1 ? 'person' : 'people'}${loaded.lastRun.failed > 0 ? `, ${loaded.lastRun.failed} not delivered` : ''}.`
                      : 'No digest has been sent yet.'}
                  </p>
                  {canManage && <SendTestDigestButton />}
                </div>
              </SettingsSection>
            </div>
          )}
        </>
      )}
    </div>
  );
}
