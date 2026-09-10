'use client';

import type { PublicStatusService, PublicUptimeWindow } from '@/lib/status-pages/public-contract';
import { describeUptimeWindow, UPTIME_TIER_LABEL } from '@/lib/status-pages/presentation';

function publishedSlaLabel(window: PublicUptimeWindow | undefined) {
  if (window?.grade === 'EXCELLENT') return UPTIME_TIER_LABEL.excellent;
  if (window?.grade === 'GOOD') return UPTIME_TIER_LABEL.good;
  if (window?.grade === 'BELOW_TARGET') return UPTIME_TIER_LABEL.poor;
  return null;
}

function publishedMeterTier(window: PublicUptimeWindow | undefined) {
  if (window?.grade === 'EXCELLENT') return 'excellent';
  if (window?.grade === 'GOOD') return 'good';
  if (window?.grade === 'BELOW_TARGET') return 'poor';
  return 'unknown';
}

const WINDOWS = [
  { key: 'days30', label: '30 days' },
  { key: 'days90', label: '90 days' },
] as const;

/** Published availability windows only — grades come from the snapshot, never recomputed. */
export default function StatusPageUptimeMetrics({ services }: { services: PublicStatusService[] }) {
  const measured = services.filter(service => service.uptime);
  if (measured.length === 0) return null;

  return (
    <section className="status-v3-uptime-metrics" aria-labelledby="uptime-metrics-heading">
      <h2 id="uptime-metrics-heading">Uptime metrics</h2>
      <div className="status-uptime-grid">
        {measured.map(service => {
          // The headline badge reflects the longer window, which is the one an SLA is written against.
          const sla = publishedSlaLabel(service.uptime?.days90);
          return (
            <article key={service.id} className="status-uptime-card status-panel">
              <div className="status-uptime-card__head">
                <h3 className="status-service__name">{service.name}</h3>
                {sla ? <span className="status-tag">{sla}</span> : null}
              </div>
              {WINDOWS.map(({ key, label }) => {
                const window = service.uptime?.[key];
                const described = describeUptimeWindow(window);
                return (
                  <div key={key} className="status-uptime-window">
                    <div className="status-uptime-window__row">
                      <span>{label}</span>
                      <span className="status-uptime-window__value">{described.value}</span>
                    </div>
                    <div
                      className="status-meter"
                      data-tier={publishedMeterTier(window)}
                      role="img"
                      aria-label={`${service.name} ${label} availability ${described.value}`}
                    >
                      <span style={{ width: `${described.meterPercent}%` }} />
                    </div>
                    <span className="status-muted">
                      {window
                        ? `${window.incidentCount} ${window.incidentCount === 1 ? 'incident' : 'incidents'}`
                        : 'No data'}
                      {described.coverage ? ` · ${described.coverage}` : ''}
                      {described.partial ? ' · Partial history' : ''}
                    </span>
                  </div>
                );
              })}
            </article>
          );
        })}
      </div>
    </section>
  );
}
