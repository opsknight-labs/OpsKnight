'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/timezone';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import { STATUS_PAGE_PUBLIC_CSS, STATUS_PAGE_SURFACE_CLASS } from '@/lib/status-pages/public-css';
import StatusPageHeader from './StatusPageHeader';
import StatusPageFooter from './StatusPageFooter';
import StatusPageSubscribe from './StatusPageSubscribe';
import StatusPageSubscribeModal from './StatusPageSubscribeModal';
import { presentOverallHeadline } from '@/lib/status-pages/status-presentation';
import StatusHeroV3 from './v3/StatusHeroV3';
import ServiceHealthV3 from './v3/ServiceHealthV3';
import RegionHealthV3 from './v3/RegionHealthV3';
import MaintenanceV3 from './v3/MaintenanceV3';
import IncidentsV3 from './v3/IncidentsV3';
import AnnouncementsV3, { ChangelogV3 } from './v3/AnnouncementsV3';

/**
 * Public status page: branding chrome around the V3-native presentation tree.
 *
 * Health, uptime, and region status are never recomputed here.
 */
export default function StatusPageV3({
  snapshot,
  stale = false,
  styleMode = 'inline',
  subscribeEnabled = true,
  refreshIntervalSeconds = null,
}: {
  snapshot: PublicStatusPageSnapshot;
  stale?: boolean;
  styleMode?: 'inline' | 'inherited';
  subscribeEnabled?: boolean;
  /** Live-page auto-refresh period. Null in preview or when refresh is disabled. */
  refreshIntervalSeconds?: number | null;
}) {
  const page = snapshot.page;
  const branding = page.branding ?? {};
  const presentation = page.presentation;
  const capabilities = page.capabilities;
  const resources = page.resources;
  const vis = page.visibility;
  const [timeZone, setTimeZone] = useState('UTC');
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const id = window.setTimeout(() => setTimeZone(tz), 0);
    return () => window.clearTimeout(id);
  }, []);

  const visible = (key: keyof NonNullable<typeof vis>, capability?: boolean) => {
    if (capability === false) return false;
    if (!vis) return true;
    switch (key) {
      case 'services':
        return vis.services === true;
      case 'incidents':
        return vis.incidents === true;
      case 'metrics':
        return vis.metrics === true;
      case 'uptime':
        return vis.uptime === true;
      case 'regions':
        return vis.regions === true;
      case 'changelog':
        return vis.changelog === true;
      case 'subscribe':
        return vis.subscribe === true;
      default:
        return true;
    }
  };

  const showHeader = (presentation?.showHeader ?? branding.showHeader) !== false;
  const showFooter = (presentation?.showFooter ?? branding.showFooter) !== false;
  const showServices = visible('services', capabilities?.services) && snapshot.services.length > 0;
  const showRegions =
    visible('regions', capabilities?.regions) &&
    page.showRegionHeatmap === true &&
    snapshot.regions.length > 0;
  const showUptime =
    visible('uptime', capabilities?.uptime) &&
    visible('metrics') &&
    snapshot.services.some(service => service.uptime);
  const showIncidents =
    visible('incidents', capabilities?.incidents) && snapshot.incidents.length > 0;
  const showMaintenance =
    capabilities?.maintenance !== false && (snapshot.maintenance?.length ?? 0) > 0;
  const showAnnouncements =
    capabilities?.announcements !== false && snapshot.announcements.length > 0;
  const showChangelog =
    visible('changelog', capabilities?.changelog) &&
    page.showChangelog !== false &&
    (snapshot.changelog?.length ?? 0) > 0;
  const showSubscribe =
    visible('subscribe', capabilities?.subscriptions) &&
    (page.subscription?.enabled ?? page.showSubscribe) === true;
  // When the JSON/RSS API requires a token, anonymous footer/header links would 401 — hide them.
  const apiRequiresToken = page.statusApiRequireToken === true;
  const showApi =
    !apiRequiresToken &&
    (presentation?.showApiLink ?? branding.showApiLink) !== false &&
    resources?.jsonApi !== false;
  const showRss =
    !apiRequiresToken &&
    (presentation?.showRssLink ?? branding.showRssLink) !== false &&
    capabilities?.rss !== false &&
    resources?.rss !== false;
  const showCsv =
    page.enableUptimeExports === true &&
    showUptime &&
    resources?.uptimeCsv !== false &&
    capabilities?.uptimeCsv !== false;
  const showPdf =
    page.enableUptimeExports === true &&
    showUptime &&
    resources?.uptimePdf !== false &&
    capabilities?.uptimePdf !== false;
  const postmortemsEnabled =
    page.showPostIncidentReview === true &&
    capabilities?.postmortems !== false &&
    resources?.postmortems !== false;

  const statusPagePath =
    page.slug && !page.isDefault ? `/status/${encodeURIComponent(page.slug)}` : '/status';
  const apiPath =
    page.slug && !page.isDefault ? `/api/status/${encodeURIComponent(page.slug)}` : '/api/status';

  const serviceOptions = snapshot.services.map(s => ({ id: s.id, name: s.name }));
  const rssHref = showRss ? `${apiPath}/rss` : null;

  return (
    <div className={STATUS_PAGE_SURFACE_CLASS}>
      {styleMode === 'inline' && <style>{STATUS_PAGE_PUBLIC_CSS}</style>}

      {showHeader && (
        <StatusPageHeader
          statusPage={{
            name: page.name,
            contactEmail: page.contactEmail,
            contactUrl: page.contactUrl,
          }}
          branding={branding}
          rssHref={rssHref}
          apiHref={showApi ? apiPath : null}
          onSubscribeClick={showSubscribe && subscribeEnabled ? () => setSubscribeOpen(true) : null}
          timeZone={timeZone}
          generatedAt={snapshot.freshness?.generatedAt ?? snapshot.generatedAt}
          refreshIntervalSeconds={refreshIntervalSeconds}
        />
      )}

      {stale && (
        <p role="note" className="status-muted">
          Showing the last verified status update.
        </p>
      )}
      <span className="sr-only">Times shown in your local time</span>

      <div className="status-v3">
        <StatusHeroV3
          overall={{
            ...snapshot.overall,
            headline: presentOverallHeadline(
              snapshot.overall,
              snapshot.services.map(service => service.status)
            ),
          }}
          updatedLabel={formatDateTime(snapshot.generatedAt, timeZone, {
            format: 'short',
            hour12: true,
          })}
        />
        {showMaintenance && (
          <MaintenanceV3 maintenance={snapshot.maintenance} timeZone={timeZone} />
        )}
        {showAnnouncements && (
          <AnnouncementsV3 announcements={snapshot.announcements} timeZone={timeZone} />
        )}
        {showRegions && <RegionHealthV3 regions={snapshot.regions} />}
        {showServices && (
          <ServiceHealthV3
            services={snapshot.services}
            timeZone={timeZone}
            groupByRegion={page.showServicesByRegion === true}
            showUptime={showUptime}
          />
        )}
        {showChangelog && <ChangelogV3 changelog={snapshot.changelog} timeZone={timeZone} />}
        {showIncidents && (
          <IncidentsV3
            incidents={snapshot.incidents}
            timeZone={timeZone}
            historyDays={snapshot.retention?.requestedHistoryDays ?? snapshot.historyDays}
            postmortemHref={
              postmortemsEnabled
                ? id => `${statusPagePath}/postmortems/${encodeURIComponent(id)}`
                : undefined
            }
          />
        )}
      </div>

      {showSubscribe && (
        <section className="status-subscribe-block" aria-labelledby="subscribe-heading">
          <div className="status-section__head">
            <h2 id="subscribe-heading">Subscribe to updates</h2>
            <span className="status-section__count">Get notified when service status changes</span>
          </div>
          {subscribeEnabled ? (
            <StatusPageSubscribe
              statusPageId={page.id}
              services={serviceOptions}
              rssHref={rssHref}
            />
          ) : (
            <p className="status-muted">Subscriptions are accepted on the published status page.</p>
          )}
        </section>
      )}

      {showSubscribe && subscribeEnabled && (
        <StatusPageSubscribeModal
          open={subscribeOpen}
          statusPageId={page.id}
          services={serviceOptions}
          rssHref={rssHref}
          onClose={() => setSubscribeOpen(false)}
        />
      )}

      {showFooter && (
        <StatusPageFooter
          footerText={page.footerText}
          organizationName={page.organizationName}
          links={{
            resources: [
              ...(showApi ? [{ href: apiPath, label: 'JSON API' }] : []),
              ...(showRss ? [{ href: `${apiPath}/rss`, label: 'RSS Feed' }] : []),
              ...(showCsv
                ? [{ href: `${apiPath}/uptime-export?format=csv`, label: 'Uptime CSV' }]
                : []),
              ...(showPdf
                ? [{ href: `${apiPath}/uptime-export?format=pdf`, label: 'Uptime PDF' }]
                : []),
            ],
            support: [
              ...(page.contactEmail
                ? [{ href: `mailto:${page.contactEmail}`, label: 'Contact' }]
                : []),
              ...(page.contactUrl ? [{ href: page.contactUrl, label: 'Support' }] : []),
            ],
          }}
        />
      )}
    </div>
  );
}
