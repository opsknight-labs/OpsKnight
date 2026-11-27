'use client';

import { useEffect, useState } from 'react';
import { StatusLocaleProvider } from '@/lib/status-pages/i18n/context';
import {
  createTranslator,
  formatLocalizedDateTime,
  normalizeLocale,
} from '@/lib/status-pages/i18n';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import { STATUS_PAGE_PUBLIC_CSS, STATUS_PAGE_SURFACE_CLASS } from '@/lib/status-pages/public-css';
import { isDarkHex } from '@/lib/status-page-theme';
import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  compileStatusPageThemeCss,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';
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
 * Health, uptime, and region status are never recomputed here. The curated built-in theme is also
 * resolved here from snapshot branding, so preview and public rendering cannot drift into separate
 * theme implementations.
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
  const [subscribeGroupId, setSubscribeGroupId] = useState<string | null>(null);
  const themeBranding = branding as typeof branding & {
    themeId?: unknown;
    themeDensity?: unknown;
  };
  const selectedTheme = resolveStatusPageTheme(themeBranding.themeId);
  const themeDensity = resolveStatusPageThemeDensity(themeBranding.themeDensity);
  const builtInThemeCss = compileStatusPageThemeCss(selectedTheme.id, themeDensity);
  // Dark widget styling follows the page's own theme, never the visitor's OS or the console theme.
  const surfaceTheme =
    selectedTheme.mode === 'dark' ||
    (selectedTheme.id === DEFAULT_STATUS_PAGE_THEME_ID && isDarkHex(branding.backgroundColor))
      ? 'dark'
      : 'light';

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
  // Business rows count: groups that hide every member still have rows with no service rows.
  const groupRows =
    page.serviceLayout && page.serviceLayout !== 'FLAT' ? (snapshot.businessServices ?? []) : [];
  const showServices =
    visible('services', capabilities?.services) &&
    (snapshot.services.length > 0 || groupRows.length > 0);
  const showRegions =
    visible('regions', capabilities?.regions) &&
    page.showRegionHeatmap === true &&
    snapshot.regions.length > 0;
  const rows = [...snapshot.services, ...groupRows];
  const showMetrics = visible('metrics') && rows.some(row => row.uptime);
  const showUptimeHistory =
    page.visibility?.uptimeHistory !== false && rows.some(row => row.history);
  const showSlaMetrics = (presentation?.showSlaMetrics ?? branding.showSlaMetrics) !== false;
  const showUptime = visible('uptime', capabilities?.uptime) && (showMetrics || showUptimeHistory);
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
    resources?.uptimeCsv !== false &&
    capabilities?.uptimeCsv !== false;
  const showPdf =
    page.enableUptimeExports === true &&
    resources?.uptimePdf !== false &&
    capabilities?.uptimePdf !== false;
  const postmortemsEnabled =
    page.showPostIncidentReview === true &&
    capabilities?.postmortems !== false &&
    resources?.postmortems !== false;

  const statusPagePath =
    page.slug && !page.isDefault ? `/status/${encodeURIComponent(page.slug)}` : '/status';
  // Permalink, history and embed routes exist only under /status/[slug].
  const hasSlugRoutes = Boolean(page.slug && !page.isDefault);
  // Subscribe APIs live under /api/status/[slug]; the route key "default" resolves the default page,
  // which usually has no slug. Without it, webhook, Slack, Teams and SMS never showed there.
  const subscribeSlug = page.slug || (page.isDefault ? 'default' : null);
  const webhookSlug =
    subscribeSlug && page.subscription?.channels?.includes('WEBHOOK') ? subscribeSlug : null;
  const subscribeChannels = page.subscription?.channels ?? null;
  const apiPath =
    page.slug && !page.isDefault ? `/api/status/${encodeURIComponent(page.slug)}` : '/api/status';

  // Grouped pages let visitors follow a business service; services outside every group stay
  // individually selectable.
  const businessOptions =
    page.serviceLayout && page.serviceLayout !== 'FLAT' ? (snapshot.businessServices ?? []) : [];
  const groupedServiceIds = new Set(businessOptions.flatMap(item => item.memberServiceIds));
  const serviceOptions = [
    ...businessOptions.map(item => ({ id: item.id, name: item.name, kind: 'business' as const })),
    ...snapshot.services
      .filter(service => !groupedServiceIds.has(service.id))
      .map(service => ({ id: service.id, name: service.name, kind: 'service' as const })),
  ];
  const rssHref = showRss ? `${apiPath}/rss` : null;

  const locale = normalizeLocale(presentation?.locale);
  const t = createTranslator(locale);
  const incidentHref = hasSlugRoutes
    ? (id: string) => `${statusPagePath}/incidents/${encodeURIComponent(id)}`
    : undefined;
  return (
    <StatusLocaleProvider locale={locale}>
      <div
        lang={locale}
        className={STATUS_PAGE_SURFACE_CLASS}
        data-sp-theme={selectedTheme.id}
        data-sp-theme-version={selectedTheme.version}
        data-sp-density={themeDensity}
        data-surface-theme={surfaceTheme}
      >
        {styleMode === 'inline' && <style>{STATUS_PAGE_PUBLIC_CSS}</style>}
        {builtInThemeCss && <style data-status-page-theme-runtime>{builtInThemeCss}</style>}

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
            onSubscribeClick={
              showSubscribe && subscribeEnabled ? () => setSubscribeOpen(true) : null
            }
            timeZone={timeZone}
            generatedAt={snapshot.freshness?.generatedAt ?? snapshot.generatedAt}
            refreshIntervalSeconds={refreshIntervalSeconds}
          />
        )}

        {stale && (
          <p role="note" className="status-muted status-stale-note">
            {t('page.staleNote')}
          </p>
        )}
        <span className="sr-only">{t('page.localTime')}</span>

        <div className="status-v3">
          <StatusHeroV3
            overall={{
              ...snapshot.overall,
              headline: presentOverallHeadline(
                snapshot.overall,
                snapshot.services.map(service => service.status)
              ),
            }}
            updatedLabel={formatLocalizedDateTime(snapshot.generatedAt, locale, timeZone)}
          />
          {showMaintenance && (
            <MaintenanceV3 maintenance={snapshot.maintenance} timeZone={timeZone} />
          )}
          {showAnnouncements && (
            <AnnouncementsV3 announcements={snapshot.announcements} timeZone={timeZone} />
          )}
          {showIncidents && (
            <IncidentsV3
              incidents={snapshot.incidents}
              timeZone={timeZone}
              historyDays={snapshot.retention?.requestedHistoryDays ?? snapshot.historyDays}
              permalinkHref={incidentHref}
              historyHref={hasSlugRoutes ? `${statusPagePath}/history` : undefined}
              postmortemHref={
                postmortemsEnabled
                  ? id => `${statusPagePath}/postmortems/${encodeURIComponent(id)}`
                  : undefined
              }
            />
          )}
          {showRegions && <RegionHealthV3 regions={snapshot.regions} />}
          {showServices && (
            <ServiceHealthV3
              services={snapshot.services}
              layout={page.serviceLayout ?? 'FLAT'}
              businessServices={snapshot.businessServices}
              expandByDefault={page.expandGroupsByDefault === true}
              incidents={showIncidents ? snapshot.incidents : undefined}
              incidentHref={incidentHref}
              incidentsHref={showIncidents ? '#incidents' : undefined}
              timeZone={timeZone}
              groupByRegion={page.showServicesByRegion === true}
              showUptime={showUptime}
              showMetrics={showMetrics}
              showUptimeHistory={showUptimeHistory}
              showSlaMetrics={showSlaMetrics}
              showServiceMeta={(presentation?.showServiceMeta ?? branding.showServiceMeta) === true}
              onSubscribeGroup={
                showSubscribe && subscribeEnabled && businessOptions.length > 0
                  ? id => {
                      setSubscribeGroupId(id);
                      setSubscribeOpen(true);
                    }
                  : undefined
              }
            />
          )}
          {showChangelog && <ChangelogV3 changelog={snapshot.changelog} timeZone={timeZone} />}
        </div>

        {showSubscribe && (
          <section className="status-subscribe-block" aria-labelledby="subscribe-heading">
            <div className="status-section__head">
              <h2 id="subscribe-heading">{t('subscribe.title')}</h2>
              <span className="status-section__count">{t('subscribe.subtitle')}</span>
            </div>
            {subscribeEnabled ? (
              <StatusPageSubscribe
                statusPageId={page.id}
                webhookSlug={webhookSlug}
                subscribeSlug={subscribeSlug}
                channels={subscribeChannels}
                services={serviceOptions}
                rssHref={rssHref}
                apiHref={showApi ? apiPath : null}
              />
            ) : (
              <p className="status-muted">{t('subscribe.previewOnly')}</p>
            )}
          </section>
        )}

        {showSubscribe && subscribeEnabled && (
          <StatusPageSubscribeModal
            open={subscribeOpen}
            statusPageId={page.id}
            webhookSlug={webhookSlug}
            subscribeSlug={subscribeSlug}
            channels={subscribeChannels}
            services={serviceOptions}
            rssHref={rssHref}
            apiHref={showApi ? apiPath : null}
            initialSelectedId={subscribeGroupId}
            onClose={() => {
              setSubscribeOpen(false);
              setSubscribeGroupId(null);
            }}
          />
        )}

        {showSubscribe && subscribeEnabled && (
          <div className="status-subscribe-sticky">
            <button type="button" onClick={() => setSubscribeOpen(true)}>
              {t('subscribe.title')}
            </button>
          </div>
        )}

        {showFooter && (
          <StatusPageFooter
            footerText={page.footerText}
            organizationName={page.organizationName}
            links={{
              resources: [
                ...(showApi ? [{ href: apiPath, label: t('footer.jsonApi') }] : []),
                ...(showRss ? [{ href: `${apiPath}/rss`, label: t('footer.rss') }] : []),
                ...(showCsv
                  ? [{ href: `${apiPath}/uptime-export?format=csv`, label: t('footer.uptimeCsv') }]
                  : []),
                ...(showPdf
                  ? [{ href: `${apiPath}/uptime-export?format=pdf`, label: t('footer.uptimePdf') }]
                  : []),
              ],
              support: [
                ...(page.contactEmail
                  ? [{ href: `mailto:${page.contactEmail}`, label: t('footer.contact') }]
                  : []),
                ...(page.contactUrl ? [{ href: page.contactUrl, label: t('footer.support') }] : []),
              ],
            }}
          />
        )}
      </div>
    </StatusLocaleProvider>
  );
}
