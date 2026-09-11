'use client';

import { useMemo } from 'react';
import StatusPageAnnouncements from './StatusPageAnnouncements';
import StatusPageHeader from './StatusPageHeader';
import StatusPageIncidents from './StatusPageIncidents';
import StatusPageServicesLegacy from './StatusPageServicesLegacy';
import StatusPageSubscribe from './StatusPageSubscribe';
import StatusPageMetricsLegacy from './StatusPageMetricsLegacy';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import { STATUS_PAGE_PUBLIC_CSS, STATUS_PAGE_SURFACE_CLASS } from '@/lib/status-pages/public-css';
import {
  createStatusPageViewModel,
  type StatusPageSnapshotPage,
} from '@/lib/status-pages/view-model';

/**
 * The public status page, in full.
 *
 * This is the only status-page UI. The live route and the admin preview both render it, differing
 * only in where the snapshot comes from -- published, or projected from unsaved settings. Keeping
 * a second renderer for either surface is what let an administrator configure and preview one
 * experience while visitors received a different, smaller one.
 *
 * It reads the published contract directly and derives nothing about health: severity, region
 * aggregates, uptime windows and history intervals are all decided server-side. What happens here
 * is presentation only -- search, filtering, grouping, and rendering the reader's local clock.
 */
export default function StatusPageExperience({
  page,
  snapshot,
  stale = false,
  styleMode = 'inline',
  subscribeEnabled = true,
}: {
  page: StatusPageSnapshotPage;
  snapshot: PublicStatusPageSnapshot;
  stale?: boolean;
  /**
   * `inline` emits the shared stylesheet with the page. `inherited` omits it, for the preview's
   * shadow root, which already carries the same text in its baseline style element.
   */
  styleMode?: 'inline' | 'inherited';
  /** Preview renders the subscribe form for layout but must not accept real subscriptions. */
  subscribeEnabled?: boolean;
}) {
  const view = useMemo(() => createStatusPageViewModel(page, snapshot), [page, snapshot]);
  const branding =
    page.branding && typeof page.branding === 'object' && !Array.isArray(page.branding)
      ? (page.branding as Record<string, unknown>)
      : {};

  const notices = [
    ...view.announcements.filter(item => item.type !== 'UPDATE' && item.type !== 'MAINTENANCE'),
    ...(snapshot.maintenance ?? []).map(item => ({
      id: item.id,
      title: item.title,
      message: item.description ?? '',
      type: 'MAINTENANCE',
      startDate: new Date(item.startAt),
      endDate: item.endAt ? new Date(item.endAt) : null,
    })),
  ];
  const changelog =
    snapshot.changelog && snapshot.changelog.length > 0
      ? snapshot.changelog.map(entry => ({
          id: entry.id,
          title: entry.title,
          message: entry.message,
          type: 'UPDATE',
          startDate: new Date(entry.publishedAt),
          endDate: null,
        }))
      : view.announcements.filter(item => item.type === 'UPDATE');
  // Published with the snapshot, so the badge on this page grades uptime the same way the API
  // and any export do. Defaults match the column defaults for payloads written before they were.
  const thresholds = {
    excellent: snapshot.thresholds?.uptimeExcellent ?? 99.9,
    good: snapshot.thresholds?.uptimeGood ?? 99,
  };

  const incidentDisclosure = useMemo(
    () => ({
      showIncidentDetails: snapshot.incidents.some(incident => incident.id !== undefined),
      showIncidentTitles: snapshot.incidents.some(incident => incident.title !== undefined),
      showIncidentDescriptions: snapshot.incidents.some(
        incident => incident.description !== undefined
      ),
      showAffectedServices: snapshot.incidents.some(incident => incident.service !== undefined),
      showServiceRegions: snapshot.incidents.some(
        incident => incident.service?.regions !== undefined
      ),
      showIncidentTimestamps: snapshot.incidents.some(incident => incident.createdAt !== undefined),
      showIncidentUrgency: snapshot.incidents.some(incident => incident.urgency !== undefined),
    }),
    [snapshot.incidents]
  );

  const statusPagePath =
    page.slug && !page.isDefault ? `/status/${encodeURIComponent(page.slug)}` : '/status';
  const apiPath =
    page.slug && !page.isDefault ? `/api/status/${encodeURIComponent(page.slug)}` : '/api/status';

  // V3 snapshots published before section visibility was added remain readable during rollout.
  // New publishers always emit the object; the fallback mirrors the legacy page flags.
  const visibility = snapshot.page.visibility ?? {
    services: true,
    incidents: true,
    metrics: true,
    uptime: true,
    regions: true,
    changelog: page.showChangelog !== false,
    subscribe: page.showSubscribe !== false,
  };
  const showRegions =
    visibility.regions && page.showRegionHeatmap === true && snapshot.regions.length > 0;
  const hasUptime = visibility.uptime && snapshot.services.some(service => service.uptime);
  // The pre-regression service component remains presentation-only here. Its old database inputs
  // are reconstructed exclusively from the already-sanitized V3 projection; it never receives
  // incidents or service fields that the publisher withheld.
  const legacyServices = useMemo(
    () =>
      snapshot.services.map(service => ({
        id: service.id,
        name: service.name,
        description: service.description,
        status: service.status,
        region: service.regions?.join(', ') ?? null,
        slaTier: service.slaTier,
        team: service.team,
        _count: { incidents: service.activeIncidentCount },
      })),
    [snapshot.services]
  );
  const legacyMappings = useMemo(
    () =>
      snapshot.services.map(service => ({
        id: `public-${service.id}`,
        serviceId: service.id,
        displayName: service.name,
        showOnPage: true,
      })),
    [snapshot.services]
  );
  const legacyUptime90 = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.flatMap(service =>
          service.uptime?.days90.percentage == null
            ? []
            : [[service.id, service.uptime.days90.percentage]]
        )
      ),
    [snapshot.services]
  );
  const legacyUptime30 = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.flatMap(service =>
          service.uptime?.days30.percentage == null
            ? []
            : [[service.id, service.uptime.days30.percentage]]
        )
      ),
    [snapshot.services]
  );
  const legacyIncidentCounts30 = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.map(service => [service.id, service.uptime?.days30.incidentCount ?? 0])
      ),
    [snapshot.services]
  );
  const legacyIncidentCounts90 = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.map(service => [service.id, service.uptime?.days90.incidentCount ?? 0])
      ),
    [snapshot.services]
  );
  const legacyCoverage30 = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.flatMap(service => {
          const window = service.uptime?.days30;
          return window && !window.complete
            ? [
                [
                  service.id,
                  `${Math.floor(window.measuredDays)} days of available data · Partial history`,
                ],
              ]
            : [];
        })
      ),
    [snapshot.services]
  );
  const legacyCoverage90 = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.flatMap(service => {
          const window = service.uptime?.days90;
          return window && !window.complete
            ? [
                [
                  service.id,
                  `${Math.floor(window.measuredDays)} days of available data · Partial history`,
                ],
              ]
            : [];
        })
      ),
    [snapshot.services]
  );
  const legacyHistoryIncidents = useMemo(
    () =>
      snapshot.services.flatMap(service =>
        (service.history?.segments ?? []).map(segment => ({
          serviceId: service.id,
          createdAt: segment.startAt,
          resolvedAt: segment.endAt,
          status: 'RESOLVED',
          urgency:
            segment.status === 'MAJOR_OUTAGE'
              ? 'HIGH'
              : segment.status === 'MAINTENANCE'
                ? 'MAINTENANCE'
                : 'MEDIUM',
        }))
      ),
    [snapshot.services]
  );
  const legacyStatusHistory = useMemo(
    () =>
      Object.fromEntries(
        snapshot.services.flatMap(service => {
          const history = service.history;
          if (!history) return [];
          const start = new Date(history.rangeStart);
          const end = new Date(history.rangeEnd);
          const days: Array<{
            date: string;
            status: 'operational' | 'degraded' | 'outage' | 'maintenance' | 'unknown';
          }> = [];
          for (const cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
            const dayStart = new Date(cursor);
            const dayEnd = new Date(cursor);
            dayEnd.setDate(dayEnd.getDate() + 1);
            const statuses = history.segments
              .filter(
                segment => new Date(segment.startAt) < dayEnd && new Date(segment.endAt) > dayStart
              )
              .map(segment => segment.status);
            const status = statuses.includes('MAJOR_OUTAGE')
              ? 'outage'
              : statuses.includes('PARTIAL_OUTAGE') || statuses.includes('DEGRADED')
                ? 'degraded'
                : statuses.includes('MAINTENANCE')
                  ? 'maintenance'
                  : statuses.includes('UNKNOWN')
                    ? 'unknown'
                    : 'operational';
            days.push({ date: dayStart.toLocaleDateString('en-CA'), status });
          }
          return [[service.id, days]];
        })
      ),
    [snapshot.services]
  );

  return (
    <div className={STATUS_PAGE_SURFACE_CLASS}>
      {styleMode === 'inline' && <style>{STATUS_PAGE_PUBLIC_CSS}</style>}

      {branding.showHeader !== false && (
        <StatusPageHeader
          statusPage={{
            name: page.name,
            contactEmail: page.contactEmail,
            contactUrl: page.contactUrl,
          }}
          overallStatus={snapshot.overall.status}
          branding={branding}
          lastUpdated={snapshot.generatedAt}
        />
      )}

      {stale && (
        <p role="note" className="status-muted">
          Showing the last verified status update.
        </p>
      )}
      {snapshot.overall.note && (
        <p
          role="note"
          style={{
            margin: '1rem 0',
            color: 'var(--status-text-muted, #64748b)',
            fontSize: '0.875rem',
          }}
        >
          {snapshot.overall.note}
        </p>
      )}
      <span className="sr-only">Times shown in your local time</span>

      <StatusPageAnnouncements announcements={notices} />

      {visibility.services && (
        <StatusPageServicesLegacy
          services={legacyServices}
          statusPageServices={legacyMappings}
          uptime90={legacyUptime90}
          incidents={legacyHistoryIncidents}
          statusHistory={legacyStatusHistory}
          privacySettings={{
            showServiceMetrics: visibility.metrics,
            showServiceDescriptions: true,
            showServiceRegions: visibility.regions,
            showUptimeHistory: visibility.uptime,
            showTeamInformation: true,
          }}
          groupByRegionDefault={page.showServicesByRegion === true}
          showServiceOwners
          showServiceSlaTier
        />
      )}

      {showRegions && (
        <section
          aria-labelledby="region-health-heading"
          style={{ marginBottom: 'clamp(2rem, 6vw, 4rem)' }}
        >
          <div style={{ marginBottom: '1.5rem' }}>
            <h2
              id="region-health-heading"
              style={{
                fontSize: 'clamp(1.5rem, 4vw, 1.875rem)',
                fontWeight: 800,
                color: 'var(--status-text-strong, #0f172a)',
                margin: '0 0 0.25rem',
                letterSpacing: '-0.02em',
              }}
            >
              Region health
            </h2>
            <p
              style={{
                fontSize: 'clamp(0.8125rem, 2vw, 0.875rem)',
                color: 'var(--status-text-muted, #64748b)',
                margin: 0,
              }}
            >
              Service health by hosting region
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
            }}
          >
            {snapshot.regions.map(region => {
              const presentation = statusPresentation(region.status);
              return (
                <article
                  key={region.name}
                  role="region"
                  aria-label={`${region.name} services`}
                  style={{
                    padding: '1rem 1.25rem',
                    background: 'var(--status-panel-bg, #fff)',
                    border: '1px solid var(--status-panel-border, #e5e7eb)',
                    borderRadius: '0.875rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem',
                    minWidth: 0,
                    boxShadow: 'var(--status-card-shadow, 0 6px 16px rgba(15, 23, 42, 0.05))',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong style={{ fontSize: '1rem', color: 'var(--status-text, #111827)' }}>
                      {region.name}
                    </strong>
                    <span className={`status-badge status-${presentation.token}`}>
                      <span aria-hidden="true">{presentation.icon}</span> {presentation.label}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                      fontSize: '0.8125rem',
                      color: 'var(--status-text-muted, #64748b)',
                    }}
                  >
                    <span>
                      {region.totalServices} service{region.totalServices === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{region.impactedServices} impacted</span>
                    {region.maintenanceServices > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{region.maintenanceServices} maintenance</span>
                      </>
                    )}
                    {region.unknownServices > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{region.unknownServices} unknown</span>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {hasUptime && (
        <StatusPageMetricsLegacy
          services={snapshot.services.map(service => ({ id: service.id, name: service.name }))}
          incidents={[]}
          thirtyDaysAgo={snapshot.generatedAt}
          ninetyDaysAgo={snapshot.generatedAt}
          uptimeExcellentThreshold={thresholds.excellent}
          uptimeGoodThreshold={thresholds.good}
          precomputedUptime={legacyUptime90}
          precomputedUptime30={legacyUptime30}
          precomputedIncidentCounts30={legacyIncidentCounts30}
          precomputedIncidentCounts90={legacyIncidentCounts90}
          precomputedCoverage30={legacyCoverage30}
          precomputedCoverage90={legacyCoverage90}
        />
      )}

      {/* The serializer already decided what may be published, and omits the rest. These flags
          exist because the incident renderer substitutes generic fallbacks for absent fields
          ("Affected service: Service"), which would reconstruct in the UI exactly what privacy
          removed from the payload. Presence is the signal here precisely because absence is
          how the projection expresses suppression. */}
      {visibility.incidents && (
        <StatusPageIncidents
          incidents={view.incidents}
          privacySettings={incidentDisclosure}
          showPostIncidentReview={page.showPostIncidentReview}
          statusPagePath={statusPagePath}
        />
      )}

      {visibility.changelog && changelog.length > 0 && (
        <section className="status-section" aria-labelledby="changelog-heading">
          <div className="status-section__head">
            <h2 id="changelog-heading">Changelog</h2>
          </div>
          <StatusPageAnnouncements announcements={changelog} />
        </section>
      )}

      {visibility.subscribe && (
        <section className="status-section" aria-labelledby="subscribe-heading">
          <div className="status-section__head">
            <h2 id="subscribe-heading">Subscribe to updates</h2>
            <span className="status-section__count">Get notified when service status changes</span>
          </div>
          {subscribeEnabled ? (
            <StatusPageSubscribe statusPageId={page.id} />
          ) : (
            <p className="status-muted">Subscriptions are accepted on the published status page.</p>
          )}
        </section>
      )}

      {branding.showFooter !== false && (
        <footer className="status-footer">
          <p className="status-footer__brand">
            {page.footerText || (
              <>
                <span>Powered by </span>
                <a className="status-footer-link" href="https://opsknight.com/">
                  OpsKnight
                </a>
              </>
            )}
          </p>
          <nav aria-label="Status resources" className="status-footer__links">
            {branding.showApiLink !== false && (
              <a className="status-footer-link" href={apiPath}>
                JSON API
              </a>
            )}
            {branding.showRssLink !== false && (
              <a className="status-footer-link" href={`${apiPath}/rss`}>
                RSS
              </a>
            )}
            {page.enableUptimeExports === true && hasUptime && (
              <>
                <a className="status-footer-link" href={`${apiPath}/uptime-export?format=csv`}>
                  Uptime CSV
                </a>
                <a className="status-footer-link" href={`${apiPath}/uptime-export?format=pdf`}>
                  Uptime PDF
                </a>
              </>
            )}
            {page.contactEmail && (
              <a className="status-footer-link" href={`mailto:${page.contactEmail}`}>
                Contact
              </a>
            )}
            {page.contactUrl && (
              <a className="status-footer-link" href={page.contactUrl}>
                Support
              </a>
            )}
          </nav>
        </footer>
      )}
    </div>
  );
}
