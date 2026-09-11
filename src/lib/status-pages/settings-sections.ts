const sectionFields = new Map<string, readonly string[]>([
  [
    'general',
    [
      'name',
      'slug',
      'organizationName',
      'subdomain',
      'customDomain',
      'enabled',
      'requireAuth',
    ],
  ],
  ['appearance', ['branding']],
  ['customization', ['branding']],
  [
    'services',
    [
      'serviceIds',
      'serviceConfigs',
      'showServices',
      'showServicesByRegion',
      'showServiceOwners',
      'showServiceSlaTier',
    ],
  ],
  [
    'privacy',
    [
      'privacyMode',
      'requireAuth',
      'authProvider',
      'showIncidentDetails',
      'showIncidentTitles',
      'showIncidentDescriptions',
      'showAffectedServices',
      'showIncidentTimestamps',
      'showServiceMetrics',
      'showServiceDescriptions',
      'showServiceRegions',
      'showTeamInformation',
      'showIncidentUrgency',
      'showUptimeHistory',
      'showRecentIncidents',
      'showIncidentHistoryDetails',
      'incidentHistoryDetailDays',
      'maxIncidentsToShow',
      'incidentHistoryDays',
      'dataRetentionDays',
    ],
  ],
  [
    'content',
    [
      'showIncidents',
      'showMetrics',
      'showSubscribe',
      'footerText',
      'contactEmail',
      'contactUrl',
      'showChangelog',
      'showRegionHeatmap',
      'showPostIncidentReview',
    ],
  ],
  [
    'advanced',
    [
      'uptimeExcellentThreshold',
      'uptimeGoodThreshold',
      'enableUptimeExports',
      'statusApiRequireToken',
      'statusApiRateLimitEnabled',
      'statusApiRateLimitMax',
      'statusApiRateLimitWindowSec',
    ],
  ],
]);

/**
 * Carries the originating section to the shared settings handler for audit purposes. A header
 * rather than a body field, because section payloads are filtered to their own allow-list.
 */
export const STATUS_PAGE_SECTION_HEADER = 'x-status-page-section';

export function statusPageSectionFields(section: string): ReadonlySet<string> | null {
  const fields = sectionFields.get(section);
  return fields ? new Set(['id', 'expectedUpdatedAt', ...fields]) : null;
}

export function statusPageSectionPatch(section: string, values: Record<string, unknown>) {
  const fields = statusPageSectionFields(section);
  if (!fields) throw new Error('This section saves changes using its own controls.');
  return Object.fromEntries(Object.entries(values).filter(([key]) => fields.has(key)));
}
