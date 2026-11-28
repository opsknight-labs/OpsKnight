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
      'contactEmail',
      'contactUrl',
    ],
  ],
  ['appearance', ['branding']],
  ['design', ['branding']],
  ['customization', ['branding']],
  [
    'services',
    [
      'serviceIds',
      'serviceConfigs',
      'serviceLayout',
      'expandGroupsByDefault',
      'businessServiceIds',
      'businessServiceConfigs',
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
      'ipAllowList',
      'showIncidentDetails',
      'showIncidentTitles',
      'showIncidentDescriptions',
      'showAffectedServices',
      'showIncidentTimestamps',
      'showServiceMetrics',
      'showServiceDescriptions',
      'showServiceRegions',
      'showTeamInformation',
      'showCustomFields',
      'showIncidentAssignees',
      'showIncidentUrgency',
      'showUptimeHistory',
      'showRecentIncidents',
      'showIncidentHistoryDetails',
      'incidentHistoryDetailDays',
      'maxIncidentsToShow',
      'incidentHistoryDays',
      'allowedCustomFields',
      'dataRetentionDays',
    ],
  ],
  [
    'content',
    [
      'showServices',
      'showIncidents',
      'showMetrics',
      'showSubscribe',
      'footerText',
      'contactEmail',
      'contactUrl',
      'showChangelog',
      'showRegionHeatmap',
      'showPostIncidentReview',
      'uptimeExcellentThreshold',
      'uptimeGoodThreshold',
      'branding',
      'showRecentIncidents',
      'showServiceMetrics',
    ],
  ],
  [
    'advanced',
    [
      'branding',
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

/**
 * The page shares one form across its sections, and a few settings are in the allow-list of
 * sections whose page does not edit them. A section's save carries only what its own page edits,
 * so it never publishes an unsaved edit made in another section.
 */
const notEditedHere = new Map<string, ReadonlySet<string>>([
  ['content', new Set(['contactEmail', 'contactUrl'])],
  ['advanced', new Set(['uptimeExcellentThreshold', 'uptimeGoodThreshold'])],
  ['privacy', new Set(['requireAuth'])],
  [
    'services',
    new Set(['showServices', 'showServicesByRegion', 'showServiceOwners', 'showServiceSlaTier']),
  ],
]);

/** Branding is one object edited on three pages; the server merges the keys a save sends. */
const appearanceBranding = [
  'logoUrl',
  'faviconUrl',
  'primaryColor',
  'backgroundColor',
  'textColor',
  'fontFamily',
  'customCss',
  'layout',
  'showHeader',
  'showFooter',
  'themeId',
  'themeVersion',
  'themeDensity',
  'colorScheme',
];
const brandingEditedHere = new Map<string, ReadonlySet<string>>([
  ['appearance', new Set(appearanceBranding)],
  ['design', new Set(appearanceBranding)],
  ['customization', new Set(appearanceBranding)],
  ['content', new Set(['metaTitle', 'metaDescription', 'showSlaMetrics', 'showServiceMeta'])],
  ['advanced', new Set(['autoRefresh', 'refreshInterval', 'showRssLink', 'showApiLink'])],
]);

export function statusPageSectionPatch(section: string, values: Record<string, unknown>) {
  const fields = statusPageSectionFields(section);
  if (!fields) throw new Error('This section saves changes using its own controls.');
  const skipped = notEditedHere.get(section);
  const branding = brandingEditedHere.get(section);
  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => fields.has(key) && !skipped?.has(key))
      .map(([key, value]): [string, unknown] =>
        key === 'branding' && branding && value && typeof value === 'object'
          ? [
              key,
              Object.fromEntries(
                Object.entries(value).filter(([name]) => name === 'version' || branding.has(name))
              ),
            ]
          : [key, value]
      )
  );
}
