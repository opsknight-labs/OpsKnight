import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import { OVERALL_DETAIL, statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';

/**
 * Compact overall-status panel. Figures come from the V3 `overall` block only.
 * The status badge, headline and note are derived server-side; this only arranges them.
 */
export default function StatusHeroV3({
  overall,
  updatedLabel,
}: {
  overall: PublicStatusPageSnapshot['overall'];
  updatedLabel?: string | null;
}) {
  const token = statusPresentation(overall.status).token;
  const presentation = statusPresentation(overall.status);
  const impacted = overall.impactedServiceCount;
  const stats: Array<{ label: string; value: number | undefined; hint?: string }> = [
    {
      label: 'Services',
      value: overall.totalServiceCount,
      hint:
        impacted != null
          ? impacted === 0
            ? 'all operational'
            : `${impacted} affected`
          : undefined,
    },
    { label: 'Active incidents', value: overall.activeIncidentCount },
    { label: 'In maintenance', value: overall.maintenanceCount },
  ];
  const visibleStats = stats.filter(stat => stat.value != null);

  return (
    <section
      className="status-v3-hero"
      data-status={token}
      aria-labelledby="status-v3-hero-heading"
    >
      <div className="status-v3-hero__main">
        <div className="status-v3-hero__status-row">
          <span className="status-v3-hero__live" aria-hidden="true" />
          <StatusBadge
            status={overall.status}
            label={presentation.label}
            size="sm"
            showDot
            pulse={overall.status !== 'OPERATIONAL'}
          />
        </div>
        <div className="status-v3-hero__copy">
          <h1 id="status-v3-hero-heading" aria-live="polite">
            {overall.headline}
          </h1>
          <p className="status-v3-hero__note">
            {overall.note ?? OVERALL_DETAIL[overall.status]}
            {updatedLabel && (
              <span className="status-v3-hero__updated" suppressHydrationWarning>
                {' '}
                · Updated {updatedLabel}
              </span>
            )}
          </p>
          {overall.confidence !== 'complete' && (
            <p className="status-v3-hero__confidence">
              {overall.unknownServiceCount} of{' '}
              {overall.knownServiceCount + overall.unknownServiceCount} services unverified
            </p>
          )}
        </div>
      </div>
      {visibleStats.length > 0 && (
        <dl className="status-v3-hero__stats">
          {visibleStats.map(stat => (
            <div key={stat.label} className="status-stat">
              <dt className="status-stat__label">{stat.label}</dt>
              <dd className="status-stat__value">{stat.value}</dd>
              {stat.hint && <dd className="status-stat__hint">{stat.hint}</dd>}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}