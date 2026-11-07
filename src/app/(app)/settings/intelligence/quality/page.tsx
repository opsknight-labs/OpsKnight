import Link from 'next/link';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { listReadableServiceOptions } from '@/lib/intelligence/settings/service-options';
import { resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { getAutoGate, getLatestQualityMeasurement } from '@/lib/intelligence/evaluation/quality';
import { AUTO_QUALITY_THRESHOLDS } from '@/lib/intelligence/evaluation/quality-metrics';
import QualityEvaluationForm from '@/components/settings/QualityEvaluationForm';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { getFeedbackSummary } from '@/lib/intelligence/squire/feedback';

export const dynamic = 'force-dynamic';
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default async function QualityPage({
  searchParams,
}: {
  searchParams?: Promise<{
    serviceId?: string | string[];
    q?: string | string[];
    after?: string | string[];
  }>;
}) {
  await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const actor = await getCurrentAuthorizationActor();
  const params = await searchParams;
  const options = await listReadableServiceOptions(actor, {
    q: params?.q,
    after: params?.after,
    serviceId: params?.serviceId,
  });
  const services = [...options.services];
  const service = options.selected;
  if (service && !services.some(row => row.id === service.id)) services.unshift(service);
  const pageHref = (after?: string) => {
    const query = new URLSearchParams();
    if (options.q) query.set('q', options.q);
    if (service) query.set('serviceId', service.id);
    if (after) query.set('after', after);
    return `/settings/intelligence/quality?${query}`;
  };
  const policy = service ? await resolveEffectivePolicy(service.id) : null;
  const [gate, measurement] =
    service && policy
      ? await Promise.all([
          getAutoGate(service.id, policy.definition),
          getLatestQualityMeasurement(service.id),
        ])
      : [null, null];
  const metrics = measurement?.metrics;
  const feedback = await getFeedbackSummary(30).catch(() => null);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Grouping quality</h1>
        <p className="text-sm text-muted-foreground">
          Compare recorded grouping decisions with explicit human reviews. Unreviewed pairs are
          never counted as negatives.
        </p>
      </header>
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Search services">
        {service && <input type="hidden" name="serviceId" value={service.id} />}
        <div className="min-w-0 space-y-1">
          <label htmlFor="quality-search" className="block text-sm font-medium">
            Search services
          </label>
          <input
            id="quality-search"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={options.q}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-md border border-border px-3 py-2 text-sm"
        >
          Search
        </button>
      </form>
      {options.error && (
        <p role="status" className="text-sm text-muted-foreground">
          {options.error}
        </p>
      )}
      {options.services.length === 0 && !options.error && (
        <p role="status" className="text-sm text-muted-foreground">
          No readable services match this search.
        </p>
      )}
      <nav aria-label="Service search pages" className="flex flex-wrap gap-4 text-sm">
        {options.after && (
          <Link href={pageHref()} className="underline">
            First page
          </Link>
        )}
        {options.next && (
          <Link href={pageHref(options.next)} className="underline">
            More services
          </Link>
        )}
      </nav>
      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        aria-label="View service quality"
      >
        <input type="hidden" name="q" value={options.q} />
        {options.after && <input type="hidden" name="after" value={options.after} />}
        <div className="min-w-0 max-w-full space-y-1">
          <label htmlFor="quality-service" className="block text-sm font-medium">
            Service
          </label>
          <select
            id="quality-service"
            name="serviceId"
            defaultValue={service?.id ?? ''}
            className="min-h-10 w-full min-w-0 max-w-full rounded-md border border-border bg-background p-2 text-sm"
          >
            {!service && <option value="">Choose a service</option>}
            {services.map(row => (
              <option key={row.id} value={row.id}>
                {row.name}
                {!options.services.some(match => match.id === row.id) ? ' (current selection)' : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="min-h-10 rounded-md border border-border px-3 py-2 text-sm"
        >
          View quality
        </button>
      </form>
      {!service || !policy ? (
        <p className="text-sm text-muted-foreground">
          Choose an available service to measure its grouping quality.
        </p>
      ) : (
        <>
          <SettingsSection
            title={service.name}
            description={`Current effective mode: ${policy.effectiveMode.toLowerCase()}. Quality certification never enables AUTO by itself.`}
          >
            <div className="space-y-3 py-3">
              <p className="text-sm font-medium">
                {gate?.allowed
                  ? 'Quality qualified for automatic grouping'
                  : 'Automatic grouping unavailable'}
              </p>
              <p className="text-sm text-muted-foreground">{gate?.reason}</p>
              <p className="text-xs text-muted-foreground">
                Requires {AUTO_QUALITY_THRESHOLDS.predictions} reviewed predictions, at least{' '}
                {AUTO_QUALITY_THRESHOLDS.negativeLabels} negative and{' '}
                {AUTO_QUALITY_THRESHOLDS.criticalLabels} critical-alert labels,{' '}
                {percent(AUTO_QUALITY_THRESHOLDS.precision)} precision and no critical false merges.
                Each enabled rule also needs 100 passing predictions, including cross-service
                examples for topology. The Wilson precision lower bound must reach 95%, recall 50%,
                and false merges stay at most 1%. Evidence expires after seven days and changes to
                rules, dependencies or human reviews require re-evaluation.
              </p>
              {hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE) && (
                <QualityEvaluationForm serviceId={service.id} />
              )}
              <Link
                href="/settings/intelligence/services"
                className="inline-block text-sm underline"
              >
                Review and publish the per-service mode
              </Link>
            </div>
          </SettingsSection>
          <SettingsSection
            title="Reviewed decisions"
            description={
              measurement?.completedAt
                ? `Last ${measurement.kind.toLowerCase()} evaluation: ${measurement.completedAt.toISOString()}`
                : 'No completed measurement yet.'
            }
          >
            {metrics ? (
              <div className="space-y-4 py-3">
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Reviewed pairs', metrics.sampleCount],
                    ['Precision', percent(metrics.precision)],
                    ['Recall', percent(metrics.recall)],
                    ['False-merge rate', percent(metrics.falseMergeRate)],
                    ['Precision lower bound', percent(metrics.precisionLowerBound)],
                    ['Critical false merges', metrics.criticalFalseMerges],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-lg font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="mb-2 text-left font-medium">
                      Calibration on reviewed pairs
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="p-2">
                          Score band
                        </th>
                        <th scope="col" className="p-2">
                          Pairs
                        </th>
                        <th scope="col" className="p-2">
                          Mean score
                        </th>
                        <th scope="col" className="p-2">
                          Confirmed related
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.calibration.map(bin => (
                        <tr key={bin.from} className="border-t border-border">
                          <td className="p-2">
                            {bin.from.toFixed(1)}–{bin.to.toFixed(1)}
                          </td>
                          <td className="p-2">{bin.count}</td>
                          <td className="p-2">{percent(bin.meanScore)}</td>
                          <td className="p-2">{percent(bin.observedPositiveRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                Measure shadow quality after responders have reviewed grouping outcomes.
              </p>
            )}
          </SettingsSection>
        </>
      )}
      <SettingsSection
        title="Assistant answer feedback"
        description="Thumbs up and down on assistant answers over the last 30 days. Only the mode, the intent and a reason are stored; never the question or the answer."
      >
        {feedback && feedback.total > 0 ? (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{feedback.total}</strong> ratings: {feedback.up} helpful, {feedback.down} not
              helpful ({percent(feedback.up / feedback.total)} positive).
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">By mode</p>
                <ul className="mt-1 space-y-1">
                  {feedback.byMode.map(row => (
                    <li key={row.mode}>
                      {row.mode}: {row.up} / {row.down}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">By question type</p>
                <ul className="mt-1 space-y-1">
                  {feedback.byIntent.map(row => (
                    <li key={row.intent}>
                      {row.intent.toLowerCase().replace(/_/g, ' ')}: {row.up} / {row.down}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Reasons given</p>
                <ul className="mt-1 space-y-1">
                  {feedback.reasons.map(row => (
                    <li key={row.reason}>
                      {row.reason}: {row.count}
                    </li>
                  ))}
                  {feedback.reasons.length === 0 && <li>None yet.</li>}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            No ratings yet. People can rate each assistant answer from the chat.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
