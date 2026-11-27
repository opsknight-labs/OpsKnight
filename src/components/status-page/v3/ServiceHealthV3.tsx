'use client';

import { memo, useMemo, useState, type ReactNode } from 'react';
import type {
  PublicBusinessService,
  PublicIncident,
  PublicServiceLayout,
  PublicServiceStatus,
  PublicStatusService,
} from '@/lib/status-pages/public-contract';
import { serviceRegionBucket, serviceSearchKey } from '@/lib/status-pages/presentation';
import { STATUS_LABEL_KEYS, type I18nKey, type Translator } from '@/lib/status-pages/i18n';
import { useT } from '@/lib/status-pages/i18n/context';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';
import ServiceHistoryV3, { HistoryIncidentsContext } from './ServiceHistoryV3';
import { BusinessServiceRowV3 } from './BusinessServiceHealthV3';

type FilterKey =
  'all' | 'issues' | 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE' | 'MAINTENANCE' | PublicServiceStatus;

type SortMode = 'configured' | 'issues' | 'alphabetical';

const STATUS_FILTERS: { key: FilterKey; label: I18nKey; dotClass?: string }[] = [
  { key: 'all', label: 'filter.all' },
  {
    key: 'OPERATIONAL',
    label: 'filter.operational',
    dotClass: 'status-v3-legend-indicator--operational',
  },
  { key: 'DEGRADED', label: 'filter.degraded', dotClass: 'status-v3-legend-indicator--degraded' },
  { key: 'OUTAGE', label: 'filter.outage', dotClass: 'status-v3-legend-indicator--outage' },
  {
    key: 'MAINTENANCE',
    label: 'filter.maintenance',
    dotClass: 'status-v3-legend-indicator--maintenance',
  },
];

const IMPACT_ORDER: Record<PublicServiceStatus, number> = {
  MAJOR_OUTAGE: 5,
  PARTIAL_OUTAGE: 4,
  DEGRADED: 3,
  MAINTENANCE: 2,
  UNKNOWN: 1,
  OPERATIONAL: 0,
};

function sortByImpact(left: PublicStatusService, right: PublicStatusService) {
  const delta = IMPACT_ORDER[right.status] - IMPACT_ORDER[left.status];
  return delta !== 0 ? delta : left.name.localeCompare(right.name);
}

function sortServices(
  items: PublicStatusService[],
  mode: SortMode,
  originalOrder: Map<string, number>
): PublicStatusService[] {
  if (mode === 'alphabetical') {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === 'issues') {
    return [...items].sort(sortByImpact);
  }
  // 'configured' preserves admin snapshot order
  return [...items].sort((a, b) => {
    const idxA = originalOrder.get(a.id) ?? 0;
    const idxB = originalOrder.get(b.id) ?? 0;
    return idxA - idxB;
  });
}

function sortRows<T extends { id: string; name: string; status: PublicServiceStatus }>(
  items: T[],
  mode: SortMode
): T[] {
  if (mode === 'alphabetical') return [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (mode === 'issues')
    return [...items].sort(
      (a, b) => IMPACT_ORDER[b.status] - IMPACT_ORDER[a.status] || a.name.localeCompare(b.name)
    );
  return items;
}

const FILTER_THRESHOLD = 8;

function serviceMatches(service: { status: PublicServiceStatus }, filter: FilterKey) {
  if (filter === 'all') return true;
  if (filter === 'issues') return service.status !== 'OPERATIONAL';
  if (filter === 'OUTAGE') {
    return service.status === 'MAJOR_OUTAGE' || service.status === 'PARTIAL_OUTAGE';
  }
  return service.status === filter;
}

const GRADE_KEYS = new Map<string | undefined, I18nKey>([
  ['EXCELLENT', 'grade.excellent'],
  ['GOOD', 'grade.good'],
  ['BELOW_TARGET', 'grade.belowTarget'],
]);

function slaGradeLabel(grade: string | undefined, t: Translator): string | undefined {
  const key = GRADE_KEYS.get(grade);
  return key ? t(key) : grade;
}

function serviceCount(count: number, t: Translator) {
  return t(count === 1 ? 'business.serviceOne' : 'business.serviceCount', { count });
}

const ServiceRow = memo(function ServiceRow({
  service,
  timeZone,
  showUptime,
  showMetrics,
  showUptimeHistory,
  showSlaMetrics = true,
  showServiceMeta = false,
}: {
  service: PublicStatusService;
  timeZone: string;
  showUptime: boolean;
  showMetrics?: boolean;
  showUptimeHistory?: boolean;
  showSlaMetrics?: boolean;
  showServiceMeta?: boolean;
}) {
  const t = useT();
  const token = statusPresentation(service.status).token;
  const slaTier = showServiceMeta ? (service.sla?.tier ?? service.slaTier) : undefined;
  const teamName = showServiceMeta ? service.team?.name : undefined;
  const effectiveShowMetrics = showMetrics ?? showUptime;
  const effectiveShowHistory = showUptimeHistory ?? true;
  const slaGrade = service.sla?.grade ?? service.uptime?.days90?.grade;
  const hasDetails = Boolean(slaTier || teamName || (service.regions?.length ?? 0) > 0);
  const affected = service.status !== 'OPERATIONAL';

  return (
    <div
      className={`status-v3-service status-service-card${affected ? ' status-v3-service--affected' : ''}`}
      data-status={token}
      role="listitem"
    >
      <div className="status-v3-service__head">
        <div className="status-v3-service__lead">
          <svg
            className="status-v3-service__icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
            <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
            <line x1="6" x2="6.01" y1="6" y2="6" />
            <line x1="6" x2="6.01" y1="18" y2="18" />
          </svg>
          <span className="status-v3-service__name">{service.name}</span>
          {hasDetails && (
            <div className="status-v3-service__meta">
              {slaTier ? (
                <span className="status-v3-chip">{t('services.tier', { tier: slaTier })}</span>
              ) : null}
              {teamName ? (
                <span className="status-v3-chip status-v3-chip--muted">
                  {t('services.ownedBy', { team: teamName })}
                </span>
              ) : null}
              {service.regions?.map(region => (
                <span key={region} className="status-v3-chip status-v3-chip--muted">
                  {region}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="status-v3-service__badges">
          {effectiveShowMetrics && slaGrade && (
            <StatusBadge status={slaGrade} label={slaGradeLabel(slaGrade, t)} size="xs" showDot />
          )}
          <StatusBadge
            status={service.status}
            label={t(STATUS_LABEL_KEYS[service.status])}
            size="sm"
            showDot
            pulse={affected}
          />
        </div>
      </div>

      {service.description && <p className="status-v3-service__desc">{service.description}</p>}

      {((effectiveShowHistory && service.history) || (effectiveShowMetrics && service.uptime)) && (
        <ServiceHistoryV3
          service={service}
          timeZone={timeZone}
          showGrade={false}
          showUptimeInline={effectiveShowMetrics}
          showHistoryBars={effectiveShowHistory}
          showSlaMetrics={showSlaMetrics}
        />
      )}
    </div>
  );
});

const ServiceList = memo(function ServiceList({
  services,
  timeZone,
  showUptime,
  showMetrics,
  showUptimeHistory,
  showSlaMetrics = true,
  showServiceMeta = false,
}: {
  services: PublicStatusService[];
  timeZone: string;
  showUptime: boolean;
  showMetrics?: boolean;
  showUptimeHistory?: boolean;
  showSlaMetrics?: boolean;
  showServiceMeta?: boolean;
}) {
  return (
    <div className="status-v3-services__list" role="list">
      {services.map(service => (
        <ServiceRow
          key={service.id}
          service={service}
          timeZone={timeZone}
          showUptime={showUptime}
          showMetrics={showMetrics}
          showUptimeHistory={showUptimeHistory}
          showSlaMetrics={showSlaMetrics}
          showServiceMeta={showServiceMeta}
        />
      ))}
    </div>
  );
});

/** Service list from V3. Status, SLA grade and the history bars are all backend-supplied. */
export default function ServiceHealthV3({
  services,
  timeZone,
  groupByRegion = true,
  showUptime = true,
  showMetrics,
  showUptimeHistory,
  showSlaMetrics = true,
  showServiceMeta = false,
  onSubscribeGroup,
  filterThreshold = FILTER_THRESHOLD,
  layout = 'FLAT',
  businessServices = [],
  expandByDefault = false,
  incidents,
  incidentHref,
  incidentsHref,
}: {
  services: PublicStatusService[];
  timeZone: string;
  /** Business-service groups start open; affected ones open regardless. */
  expandByDefault?: boolean;
  /** Published incidents, listed by title in a bar's day inspector. */
  incidents?: PublicIncident[];
  incidentHref?: (incidentId: string) => string;
  /** Target of a group row's active-incident chip (the incidents section). */
  incidentsHref?: string;
  /** BUSINESS and BUSINESS_EXPANDABLE group rows under business services. */
  layout?: PublicServiceLayout;
  businessServices?: PublicBusinessService[];
  groupByRegion?: boolean;
  showUptime?: boolean;
  showMetrics?: boolean;
  showUptimeHistory?: boolean;
  showSlaMetrics?: boolean;
  /** Tier and owning-team chips; hidden unless the page opts in. */
  showServiceMeta?: boolean;
  onSubscribeGroup?: (id: string) => void;
  /** Services above this count get the Filter disclosure; below it the list is shown bare. */
  filterThreshold?: number;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortMode, setSortMode] = useState<SortMode>('configured');
  const [groupRegions, setGroupRegions] = useState(groupByRegion);
  const [controlsOpen, setControlsOpen] = useState(false);
  const businessMode = layout !== 'FLAT' && businessServices.length > 0;
  const expandable = layout === 'BUSINESS_EXPANDABLE';
  // Search, status chips and sort only earn their space on long lists. Grouped pages count the
  // rows a visitor scans: business services plus the services outside every group.
  const groupedIds = new Set(businessServices.flatMap(item => item.memberServiceIds));
  const rowCount = businessMode
    ? businessServices.length + services.filter(service => !groupedIds.has(service.id)).length
    : services.length;
  const showControls = rowCount > filterThreshold;
  // Affected business services start open so visitors see which part is down, and one that
  // becomes affected on a live refresh opens again even if the visitor closed it earlier.
  const affectedKey = [
    ...new Set(
      businessServices
        .filter(item => item.status !== 'OPERATIONAL')
        .flatMap(item => {
          const chain = [item.id];
          // Open ancestors too so a nested affected child is visible (bounded: depth <= 3).
          for (let at = item.parentId, n = 0; at && n < 3; n++) {
            chain.push(at);
            at = businessServices.find(other => other.id === at)?.parentId;
          }
          return chain;
        })
    ),
  ].join(',');
  const initialOpen = () =>
    new Set([
      ...(expandByDefault ? businessServices.map(item => item.id) : []),
      ...(affectedKey ? affectedKey.split(',') : []),
    ]);
  const [openIds, setOpenIds] = useState<Set<string>>(initialOpen);
  // The live preview flips the setting in place; start over from the new default.
  const [expandSetting, setExpandSetting] = useState(expandByDefault);
  if (expandSetting !== expandByDefault) {
    setExpandSetting(expandByDefault);
    setOpenIds(initialOpen());
  }
  const [seenAffectedKey, setSeenAffectedKey] = useState(affectedKey);
  if (seenAffectedKey !== affectedKey) {
    const before = new Set(seenAffectedKey ? seenAffectedKey.split(',') : []);
    const newlyAffected = affectedKey ? affectedKey.split(',').filter(id => !before.has(id)) : [];
    setSeenAffectedKey(affectedKey);
    if (newlyAffected.length) setOpenIds(current => new Set([...current, ...newlyAffected]));
  }

  // Follow the page setting when it changes (live preview) without an effect round-trip.
  const [groupSetting, setGroupSetting] = useState(groupByRegion);
  if (groupSetting !== groupByRegion) {
    setGroupSetting(groupByRegion);
    setGroupRegions(groupByRegion);
  }

  const originalOrder = useMemo(() => {
    const map = new Map<string, number>();
    services.forEach((s, idx) => map.set(s.id, idx));
    return map;
  }, [services]);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return services;
    return services.filter(service => serviceSearchKey(service).includes(needle));
  }, [services, query]);

  const canGroup = !businessMode && services.some(service => (service.regions?.length ?? 0) > 0);

  const filtered = useMemo(() => {
    const matched = searched.filter(service => serviceMatches(service, filter));
    return sortServices(matched, sortMode, originalOrder);
  }, [searched, filter, sortMode, originalOrder]);

  const serviceById = useMemo(
    () => new Map(services.map(service => [service.id, service])),
    [services]
  );
  const business = useMemo(() => {
    if (!businessMode) return null;
    const needle = query.trim().toLowerCase();
    const grouped = new Set(businessServices.flatMap(item => item.memberServiceIds));
    const rows = businessServices.flatMap(item => {
      const members = item.memberServiceIds.flatMap(id => {
        const service = serviceById.get(id);
        return service ? [service] : [];
      });
      const nameMatch = !needle || item.name.toLowerCase().includes(needle);
      const memberMatch =
        Boolean(needle) && members.some(member => serviceSearchKey(member).includes(needle));
      if (!serviceMatches(item, filter) || (!nameMatch && !memberMatch)) return [];
      return [{ item, members, revealedBySearch: memberMatch && !nameMatch }];
    });
    const sorted = sortRows(
      rows.map(row => ({ ...row, id: row.item.id, name: row.item.name, status: row.item.status })),
      sortMode
    );
    const others = filtered.filter(service => !grouped.has(service.id));
    return { rows: sorted, others, total: businessServices.length };
  }, [businessMode, businessServices, filter, filtered, query, serviceById, sortMode]);

  const historyIncidents = useMemo(
    () => ({ incidents: incidents ?? [], href: incidentHref }),
    [incidents, incidentHref]
  );

  // Groups whose members are all hidden still have rows even with no service rows.
  if (services.length === 0 && !businessMode) return null;

  // Nest child business services under their parent (depth bounded, cycle-safe at render time).
  const renderBusinessRows = (
    parentId: string | null,
    level: number,
    seen: Set<string>
  ): ReactNode => {
    if (!business || level > 3) return null;
    const present = new Set(business.rows.map(row => row.item.id));
    return business.rows
      .filter(({ item }) =>
        parentId === null
          ? !item.parentId || !present.has(item.parentId)
          : item.parentId === parentId
      )
      .filter(({ item }) => !seen.has(item.id))
      .map(({ item, members, revealedBySearch }) => {
        const nextSeen = new Set(seen).add(item.id);
        const childCount = business.rows.filter(row => row.item.parentId === item.id).length;
        return (
          <BusinessServiceRowV3
            key={item.id}
            item={item}
            members={members}
            expandable={expandable}
            level={level}
            childCount={childCount}
            childRows={childCount ? renderBusinessRows(item.id, level + 1, nextSeen) : null}
            open={revealedBySearch || openIds.has(item.id)}
            onToggle={() =>
              setOpenIds(current => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
            display={rowDisplay}
          />
        );
      });
  };

  const grouped = groupRegions && canGroup;
  const rowDisplay = {
    timeZone,
    showMetrics: showMetrics ?? showUptime,
    showUptimeHistory: showUptimeHistory ?? true,
    showSlaMetrics,
    onSubscribeGroup,
    incidentsHref,
  };

  const groups = grouped
    ? (() => {
        const buckets = new Map<string, PublicStatusService[]>();
        for (const service of filtered) {
          const region = serviceRegionBucket(service.regions);
          const members = buckets.get(region) ?? [];
          members.push(service);
          buckets.set(region, members);
        }
        return [...buckets.entries()]
          .map(([region, members]) => ({
            region,
            services: sortServices(members, sortMode, originalOrder),
          }))
          .sort((left, right) => {
            if (sortMode === 'issues') {
              const leftRank = Math.max(
                ...left.services.map(service => IMPACT_ORDER[service.status])
              );
              const rightRank = Math.max(
                ...right.services.map(service => IMPACT_ORDER[service.status])
              );
              if (rightRank !== leftRank) return rightRank - leftRank;
            }
            return left.region.localeCompare(right.region);
          });
      })()
    : null;

  return (
    <HistoryIncidentsContext.Provider value={historyIncidents}>
      <section className="status-v3-services" aria-labelledby="status-v3-services-heading">
        <div className="status-v3-services__top-row">
          <div className="status-v3-services__title-group">
            <h2
              id="status-v3-services-heading"
              className="status-section-title status-v3-services__title"
            >
              {t('services.title')}
            </h2>
          </div>

          <div className="status-v3-services__right-group">
            {showControls && (
              <button
                type="button"
                className={`status-v3-filter-chip${controlsOpen ? ' status-v3-filter-chip--active' : ''}`}
                aria-expanded={controlsOpen}
                aria-controls="status-v3-services-controls"
                onClick={() => setControlsOpen(open => !open)}
              >
                {t('services.filter')}
              </button>
            )}
            {showControls && controlsOpen && (
              <div id="status-v3-services-controls" className="status-v3-services__controls">
                <div className="status-v3-search">
                  <span className="sr-only">{t('services.search')}</span>
                  <svg
                    className="status-v3-search__icon"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="search"
                    placeholder={t('services.search')}
                    aria-label={t('services.searchCount', { count: services.length })}
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                </div>

                <div
                  className="status-v3-filters"
                  role="group"
                  aria-label={t('services.filterByStatus')}
                >
                  {STATUS_FILTERS.map(item => {
                    const isSelected =
                      filter === item.key ||
                      (item.key === 'OUTAGE' &&
                        (filter === 'MAJOR_OUTAGE' || filter === 'PARTIAL_OUTAGE'));
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`status-v3-filter-chip${isSelected ? ' status-v3-filter-chip--active' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => setFilter(prev => (prev === item.key ? 'all' : item.key))}
                      >
                        {item.dotClass && (
                          <span
                            className={`status-v3-legend-indicator ${item.dotClass}`}
                            aria-hidden="true"
                          />
                        )}
                        <span>{t(item.label)}</span>
                      </button>
                    );
                  })}
                </div>

                <span className="status-v3-services__legend-divider" aria-hidden="true" />

                {canGroup && (
                  <button
                    type="button"
                    className={`status-v3-services__group-btn${groupRegions ? ' status-v3-services__group-btn--active' : ''}`}
                    aria-label={t('services.groupByRegion')}
                    aria-pressed={groupRegions}
                    onClick={() => setGroupRegions(open => !open)}
                  >
                    <svg
                      className="status-v3-services__group-icon"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                      <path d="M2 12h20" />
                    </svg>
                    <span>
                      {groupRegions ? t('services.groupedByRegion') : t('services.groupByRegion')}
                    </span>
                  </button>
                )}

                <div className="status-v3-services__sort-wrap">
                  <svg
                    className="status-v3-services__sort-icon"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m3 16 4 4 4-4" />
                    <path d="M7 20V4" />
                    <path d="m21 8-4-4-4 4" />
                    <path d="M17 4v16" />
                  </svg>
                  <label htmlFor="status-v3-sort-select" className="sr-only">
                    {t('services.sort')}
                  </label>
                  <select
                    id="status-v3-sort-select"
                    className="status-v3-services__sort-select"
                    aria-label={t('services.sort')}
                    value={sortMode}
                    onChange={event => setSortMode(event.target.value as SortMode)}
                  >
                    <option value="configured">{t('services.sortConfigured')}</option>
                    <option value="issues">{t('services.sortIssues')}</option>
                    <option value="alphabetical">{t('services.sortAlphabetical')}</option>
                  </select>
                  <svg
                    className="status-v3-services__sort-chevron"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
            )}
            <span className="status-v3-services__legend-divider" aria-hidden="true" />

            <div className="status-v3-services__legend-window">
              <span className="status-v3-services__legend-count">
                {business
                  ? business.rows.length === business.total
                    ? t(business.total === 1 ? 'services.businessOne' : 'services.businessCount', {
                        count: business.total,
                      })
                    : t('services.countOf', { shown: business.rows.length, total: business.total })
                  : filtered.length === services.length
                    ? serviceCount(services.length, t)
                    : t('services.countOf', { shown: filtered.length, total: services.length })}
              </span>
              <span className="status-v3-services__legend-dot" aria-hidden="true">
                ·
              </span>
              <svg
                className="status-v3-legend-clock"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{t('services.last90')}</span>
            </div>
          </div>
        </div>

        {business ? (
          business.rows.length === 0 && business.others.length === 0 ? (
            <div className="status-v3-services__empty" role="status">
              <p className="status-v3-services__empty-title">{t('services.noMatch')}</p>
              <button
                type="button"
                className="status-v3-services__empty-reset"
                onClick={() => {
                  setFilter('all');
                  setQuery('');
                }}
              >
                {t('services.clearFilters')}
              </button>
            </div>
          ) : (
            <>
              {business.rows.length > 0 && (
                <div
                  className="status-v3-services__list"
                  role="list"
                  aria-label={t('business.list')}
                >
                  {renderBusinessRows(null, 1, new Set())}
                </div>
              )}
              {business.others.length > 0 && (
                <div className="status-v3-group status-v3-business-others">
                  <div className="status-v3-group__head">
                    <div className="status-v3-group__title-wrap">
                      <h3 className="status-v3-group__title">{t('services.others')}</h3>
                      <span className="status-v3-group__subtitle">
                        {serviceCount(business.others.length, t)}
                      </span>
                    </div>
                  </div>
                  <ServiceList
                    services={business.others}
                    timeZone={timeZone}
                    showUptime={showUptime}
                    showMetrics={showMetrics}
                    showUptimeHistory={showUptimeHistory}
                    showSlaMetrics={showSlaMetrics}
                    showServiceMeta={showServiceMeta}
                  />
                </div>
              )}
            </>
          )
        ) : filtered.length === 0 ? (
          <div className="status-v3-services__empty" role="status">
            <div className="status-v3-services__empty-icon-wrap" aria-hidden="true">
              <svg
                className="status-v3-services__empty-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="status-v3-services__empty-title">{t('services.noMatch')}</p>
            <p className="status-v3-services__empty-hint">
              {query.trim() ? t('services.noMatchQuery', { query }) : t('services.noMatchStatus')}
            </p>
            {(filter !== 'all' || query.trim() !== '') && (
              <button
                type="button"
                className="status-v3-services__empty-reset"
                onClick={() => {
                  setFilter('all');
                  setQuery('');
                }}
              >
                {t('services.clearFilters')}
              </button>
            )}
          </div>
        ) : groups ? (
          groups.map(group => {
            const impacted = group.services.filter(
              service => service.status !== 'OPERATIONAL'
            ).length;
            const healthy = impacted === 0;
            return (
              <div key={group.region} className="status-v3-group">
                <div className="status-v3-group__head">
                  <div className="status-v3-group__title-wrap">
                    <h3 className="status-v3-group__title">
                      <svg
                        className="status-v3-group__icon"
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                        <path d="M2 12h20" />
                      </svg>
                      {group.region}
                    </h3>
                    <span className="status-v3-group__subtitle">
                      {serviceCount(group.services.length, t)}
                    </span>
                  </div>
                  <div
                    className="status-v3-group__tally"
                    aria-label={
                      healthy
                        ? t('services.regionHealthy', { total: group.services.length })
                        : t('business.affectedCount', {
                            impacted,
                            total: group.services.length,
                          })
                    }
                  >
                    {healthy ? (
                      <span className="status-v3-group__tally-pill status-v3-group__tally-pill--healthy">
                        <span className="status-v3-group__dot" aria-hidden="true" />
                        {t('services.allOperational')}
                      </span>
                    ) : (
                      <span className="status-v3-group__tally-pill status-v3-group__tally-pill--impacted">
                        <span className="status-v3-group__dot" aria-hidden="true" />
                        {t('services.affected', { count: impacted })}
                      </span>
                    )}
                  </div>
                </div>
                <ServiceList
                  services={group.services}
                  timeZone={timeZone}
                  showUptime={showUptime}
                  showMetrics={showMetrics}
                  showUptimeHistory={showUptimeHistory}
                  showSlaMetrics={showSlaMetrics}
                  showServiceMeta={showServiceMeta}
                />
              </div>
            );
          })
        ) : (
          <ServiceList
            services={filtered}
            timeZone={timeZone}
            showUptime={showUptime}
            showMetrics={showMetrics}
            showUptimeHistory={showUptimeHistory}
            showSlaMetrics={showSlaMetrics}
            showServiceMeta={showServiceMeta}
          />
        )}
      </section>
    </HistoryIncidentsContext.Provider>
  );
}
