import Link from 'next/link';
import prisma from '@/lib/prisma';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { getAutoGate, getLatestQualityMeasurement } from '@/lib/intelligence/evaluation/quality';
import { AUTO_QUALITY_THRESHOLDS } from '@/lib/intelligence/evaluation/quality-metrics';
import QualityEvaluationForm from '@/components/settings/QualityEvaluationForm';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';

export const dynamic = 'force-dynamic';
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default async function QualityPage({
  searchParams,
}: {
  searchParams?: Promise<{ serviceId?: string }>;
}) {
  await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const actor = await getCurrentAuthorizationActor();
  const requested = (await searchParams)?.serviceId?.slice(0, 64);
  const readable = serviceReadWhere(actor);
  const services = await prisma.service.findMany({
    where: readable,
    orderBy: { name: 'asc' },
    take: 100,
    select: { id: true, name: true },
  });
  const service = requested
    ? await prisma.service.findFirst({
        where: { AND: [{ id: requested }, readable] },
        select: { id: true, name: true },
      })
    : services[0];
  if (service && !services.some(row => row.id === service.id)) services.push(service);
  const policy = service ? await resolveEffectivePolicy(service.id) : null;
  const [gate, measurement] =
    service && policy
      ? await Promise.all([
          getAutoGate(service.id, policy.definition),
          getLatestQualityMeasurement(service.id),
        ])
      : [null, null];
  const metrics = measurement?.metrics;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Grouping quality</h1>
        <p className="text-sm text-muted-foreground">
          Compare recorded grouping decisions with explicit human reviews. Unreviewed pairs are
          never counted as negatives.
        </p>
      </header>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="quality-service" className="block text-sm font-medium">
            Service
          </label>
          <select
            id="quality-service"
            name="serviceId"
            defaultValue={service?.id ?? ''}
            className="max-w-full rounded-md border border-border bg-background p-2 text-sm"
          >
            {!service && <option value="">Choose a service</option>}
            {services.map(row => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm">
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
    </div>
  );
}
