/* eslint-disable security/detect-object-injection -- every index below is a field name
   from a module-local `as const` table or a Prisma column list, never caller input. */
/** Bounds shared by public readers. Workspace retention may shorten these windows further. */
export function statusPagePublicationLimits(settings: {
  maxIncidentsToShow?: number | null;
  incidentHistoryDays?: number | null;
  dataRetentionDays?: number | null;
}) {
  const bounded = (value: number | null | undefined, fallback: number, maximum: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.min(maximum, Math.floor(value)))
      : fallback;
  const historyDays = bounded(settings.incidentHistoryDays, 90, 365);
  return {
    maxIncidents: bounded(settings.maxIncidentsToShow, 50, 100),
    historyDays: Math.min(historyDays, bounded(settings.dataRetentionDays, historyDays, 365)),
  };
}

/**
 * Validate contactUrl at the persistence boundary: public status pages render this as a
 * support href without additional sanitization downstream, so only safe navigable protocols
 * are accepted here rather than relying on browser URL parsing at render time.
 */
export function isAllowedStatusPageContactUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Which publication policy a configuration change requires.
 *
 * The reason this exists: withdrawing a live status page is the right move when an administrator
 * has just narrowed what the public may see, and the wrong move for every other kind of edit. The
 * two cases are indistinguishable from `revision <> publishedRevision` alone, so the intent has to
 * be derived from the change itself.
 *
 * The governing rule, applied to every entry in the tables below:
 *
 *   a change is TIGHTENING if it removes something the public could previously see, or narrows
 *   who may see it; it is RELAXING if it adds disclosure.
 *
 * Only PRIVACY_TIGHTENING and DISABLE fail closed. Everything else keeps the current projection
 * live until its replacement has been published.
 */
export type StatusPageChangeClass =
  | 'DISABLE'
  | 'PRIVACY_TIGHTENING'
  | 'ENABLE'
  | 'ROUTING'
  | 'PRIVACY_RELAXING'
  | 'CONTENT'
  | 'PRESENTATION';

/** Highest precedence first: a mixed patch is governed by its most restrictive component. */
const CLASS_PRECEDENCE: readonly StatusPageChangeClass[] = [
  'DISABLE',
  'PRIVACY_TIGHTENING',
  'ENABLE',
  'ROUTING',
  'PRIVACY_RELAXING',
  'CONTENT',
  'PRESENTATION',
];

/**
 * Booleans that gate a field in the published payload. Turning one off retracts a disclosure.
 */
export const STATUS_PAGE_DISCLOSURE_BOOLEANS = [
  'showServices',
  'showIncidents',
  'showMetrics',
  'showIncidentDetails',
  'showIncidentTitles',
  'showIncidentDescriptions',
  'showAffectedServices',
  'showIncidentTimestamps',
  'showIncidentUrgency',
  'showIncidentAssignees',
  'showServiceMetrics',
  'showServiceDescriptions',
  'showServiceRegions',
  'showServiceOwners',
  'showServiceSlaTier',
  'showTeamInformation',
  'showCustomFields',
  'showUptimeHistory',
  'showRecentIncidents',
  'showIncidentHistoryDetails',
  'showPostIncidentReview',
  'showChangelog',
  'enableUptimeExports',
] as const;

/**
 * Booleans that restrict access rather than disclose data, so the safe direction is inverted.
 *
 * `requireAuth` is the load-bearing one. Turning the login wall *on* must fail closed, because a
 * previously published payload carries `requireAuth: false` and the public route reads that value;
 * turning it *off* need not, because a stale `true` merely over-prompts.
 */
export const STATUS_PAGE_RESTRICTION_BOOLEANS = [
  'requireAuth',
  'statusApiRequireToken',
  'statusApiRateLimitEnabled',
] as const;

/** Numeric windows, with the direction that narrows what the public can retrieve. */
export const STATUS_PAGE_DISCLOSURE_BOUNDS = [
  { field: 'maxIncidentsToShow', tightenOn: 'decrease' },
  { field: 'incidentHistoryDays', tightenOn: 'decrease' },
  { field: 'incidentHistoryDetailDays', tightenOn: 'decrease' },
  { field: 'dataRetentionDays', tightenOn: 'decrease' },
  { field: 'statusApiRateLimitMax', tightenOn: 'decrease' },
  // Same request ceiling over a longer window means fewer requests allowed.
  { field: 'statusApiRateLimitWindowSec', tightenOn: 'increase' },
] as const;

export const STATUS_PAGE_ROUTING_FIELDS = [
  'slug',
  'subdomain',
  'customDomain',
  'isDefault',
] as const;

export const STATUS_PAGE_CONTENT_FIELDS = [
  'name',
  'organizationName',
  'footerText',
  'contactEmail',
  'contactUrl',
  'emailProvider',
] as const;

/**
 * Fields that change how published data is arranged, never whether it is published.
 *
 * `showServicesByRegion` and `showRegionHeatmap` sit here deliberately: they
 * re-arrange data whose disclosure is gated elsewhere (region grouping renders `service.region`,
 * which `showServiceRegions` already controls). Classifying them as disclosure is what made a
 * layout toggle take the public page offline.
 */
export const STATUS_PAGE_PRESENTATION_FIELDS = [
  'branding',
  'showSubscribe',
  'showServicesByRegion',
  'showRegionHeatmap',
  'uptimeExcellentThreshold',
  'uptimeGoodThreshold',
] as const;

/** PUBLIC is the schema default, so an absent mode is treated as PUBLIC. */
const PRIVACY_MODE_ORDINAL: Record<string, number> = {
  PUBLIC: 0,
  RESTRICTED: 1,
  PRIVATE: 2,
};

export type StatusPageServiceMappingState = {
  serviceId: string;
  showOnPage: boolean;
  displayName: string | null;
  order: number;
};

export type StatusPageClassifierState = Record<string, unknown> & {
  serviceMappings?: readonly StatusPageServiceMappingState[];
};

export type StatusPageRouteDelta = {
  /** Route keys that must resolve to this page once the change is published. */
  added: readonly string[];
  /** Route keys that must stop resolving to it, removed only after `added` verifies. */
  removed: readonly string[];
};

export type StatusPageChangeClassification = {
  /** Deduplicated, most restrictive first. Empty when the patch changes nothing. */
  classes: readonly StatusPageChangeClass[];
  dominant: StatusPageChangeClass;
  /** True when the current projection must be withdrawn before the change is written. */
  failClosed: boolean;
  revocationReason: 'PRIVACY' | 'DISABLED' | 'SUPERSEDED' | null;
  changedFields: readonly string[];
  routes: StatusPageRouteDelta;
};

/** Mirrors how the persistence layer stores text: trimmed, with empty collapsed to null. */
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

/** Stable across key order so a re-serialized branding blob is not mistaken for an edit. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function asIdSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
}

/**
 * Compare the effective public limit rather than the raw column, so an edit that both values clamp
 * to the same bound (999 -> 500 on a field capped at 100) is correctly a no-op.
 */
function effectiveBound(field: string, value: unknown, current: StatusPageClassifierState): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const settings = {
    maxIncidentsToShow: current.maxIncidentsToShow as number | null | undefined,
    incidentHistoryDays: current.incidentHistoryDays as number | null | undefined,
    dataRetentionDays: current.dataRetentionDays as number | null | undefined,
  };
  if (field === 'maxIncidentsToShow') {
    return statusPagePublicationLimits({ ...settings, maxIncidentsToShow: value }).maxIncidents;
  }
  if (field === 'incidentHistoryDays') {
    return statusPagePublicationLimits({ ...settings, incidentHistoryDays: value }).historyDays;
  }
  if (field === 'incidentHistoryDetailDays') {
    return Math.max(1, Math.min(365, Math.floor(value)));
  }
  return value;
}

/**
 * Derive the publication policy for a settings patch.
 *
 * The patch must already be normalized the way the persistence layer will store it (trimmed
 * strings, `''` collapsed to `null`), otherwise cosmetic differences such as `'' -> null` register
 * as real changes and every save fails closed again.
 */
export function classifyStatusPageChange(input: {
  current: StatusPageClassifierState;
  patch: Readonly<Record<string, unknown>>;
  /** Present only when the caller is rewriting the page's service mappings. */
  serviceIds?: readonly string[];
  serviceConfigs?: Readonly<
    Record<string, { displayName?: string | null; order?: number; showOnPage?: boolean }>
  >;
}): StatusPageChangeClassification {
  const { current, patch, serviceIds, serviceConfigs } = input;
  const found = new Set<StatusPageChangeClass>();
  const changedFields: string[] = [];
  const note = (field: string, ...classes: StatusPageChangeClass[]) => {
    changedFields.push(field);
    for (const item of classes) found.add(item);
  };
  const provided = (field: string) =>
    Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== undefined;

  for (const field of STATUS_PAGE_DISCLOSURE_BOOLEANS) {
    if (!provided(field)) continue;
    const next = patch[field] === true;
    if (next === (current[field] === true)) continue;
    note(field, next ? 'PRIVACY_RELAXING' : 'PRIVACY_TIGHTENING');
  }

  for (const field of STATUS_PAGE_RESTRICTION_BOOLEANS) {
    if (!provided(field)) continue;
    const next = patch[field] === true;
    if (next === (current[field] === true)) continue;
    note(field, next ? 'PRIVACY_TIGHTENING' : 'PRIVACY_RELAXING');
  }

  for (const { field, tightenOn } of STATUS_PAGE_DISCLOSURE_BOUNDS) {
    if (!provided(field)) continue;
    const nextValue = effectiveBound(field, patch[field], current);
    const currentValue = effectiveBound(field, current[field], current);
    if (nextValue === currentValue) continue;
    // `null` means unbounded, so null -> number narrows and number -> null widens.
    const narrowed =
      currentValue === null
        ? nextValue !== null
        : nextValue === null
          ? false
          : tightenOn === 'decrease'
            ? nextValue < currentValue
            : nextValue > currentValue;
    note(field, narrowed ? 'PRIVACY_TIGHTENING' : 'PRIVACY_RELAXING');
  }

  if (provided('privacyMode')) {
    const nextMode = String(patch.privacyMode ?? 'PUBLIC');
    const currentMode = String(current.privacyMode ?? 'PUBLIC');
    if (nextMode !== currentMode) {
      const nextRank = PRIVACY_MODE_ORDINAL[nextMode];
      const currentRank = PRIVACY_MODE_ORDINAL[currentMode];
      // An unordered mode (CUSTOM) gives no way to prove the direction, so assume the strict one.
      const tightening =
        nextRank === undefined || currentRank === undefined ? true : nextRank > currentRank;
      note('privacyMode', tightening ? 'PRIVACY_TIGHTENING' : 'PRIVACY_RELAXING');
    }
  }

  if (provided('allowedCustomFields')) {
    const next = asIdSet(patch.allowedCustomFields);
    const before = asIdSet(current.allowedCustomFields);
    const removed = [...before].some(field => !next.has(field));
    const added = [...next].some(field => !before.has(field));
    if (removed || added) {
      note('allowedCustomFields', removed ? 'PRIVACY_TIGHTENING' : 'PRIVACY_RELAXING');
    }
  }

  if (provided('authProvider')) {
    const next = normalizeText(patch.authProvider);
    if (next !== normalizeText(current.authProvider)) {
      // Behind a login wall, swapping the identity provider changes who can get in. Otherwise it
      // is inert: the provider never reaches the published payload.
      const gated = provided('requireAuth') ? patch.requireAuth === true : current.requireAuth === true;
      note('authProvider', gated ? 'PRIVACY_TIGHTENING' : 'CONTENT');
    }
  }

  if (provided('enabled')) {
    const next = patch.enabled === true;
    if (next !== (current.enabled === true)) note('enabled', next ? 'ENABLE' : 'DISABLE');
  }

  for (const field of STATUS_PAGE_CONTENT_FIELDS) {
    if (!provided(field)) continue;
    if (normalizeText(patch[field]) === normalizeText(current[field])) continue;
    note(field, 'CONTENT');
  }

  for (const field of STATUS_PAGE_PRESENTATION_FIELDS) {
    if (!provided(field)) continue;
    if (canonicalJson(patch[field]) === canonicalJson(current[field])) continue;
    note(field, 'PRESENTATION');
  }

  const routes = classifyRoutes({ current, patch, provided, note });

  if (serviceIds !== undefined) {
    const before = new Map(
      (current.serviceMappings ?? []).map(mapping => [mapping.serviceId, mapping])
    );
    const next = new Set(serviceIds);
    let tightened = false;
    let relaxed = false;
    let rearranged = false;
    for (const [serviceId, mapping] of before) {
      if (!next.has(serviceId)) {
        tightened = true;
        continue;
      }
      const config = serviceConfigs?.[serviceId];
      const showOnPage = config?.showOnPage !== false;
      if (mapping.showOnPage && !showOnPage) tightened = true;
      else if (!mapping.showOnPage && showOnPage) relaxed = true;
      const displayName = normalizeText(config?.displayName);
      if (displayName !== normalizeText(mapping.displayName)) rearranged = true;
      if ((config?.order ?? 0) !== mapping.order) rearranged = true;
    }
    for (const serviceId of next) if (!before.has(serviceId)) relaxed = true;
    if (tightened) note('serviceIds', 'PRIVACY_TIGHTENING');
    else if (relaxed) note('serviceIds', 'PRIVACY_RELAXING');
    else if (rearranged) note('serviceConfigs', 'PRESENTATION');
  }

  const classes = CLASS_PRECEDENCE.filter(item => found.has(item));
  const dominant = classes[0] ?? 'PRESENTATION';
  const failClosed = dominant === 'PRIVACY_TIGHTENING' || dominant === 'DISABLE';
  return {
    classes,
    dominant,
    failClosed,
    revocationReason:
      classes.length === 0
        ? null
        : dominant === 'DISABLE'
          ? 'DISABLED'
          : dominant === 'PRIVACY_TIGHTENING'
            ? 'PRIVACY'
            : 'SUPERSEDED',
    changedFields: [...new Set(changedFields)],
    routes,
  };
}

function classifyRoutes(args: {
  current: StatusPageClassifierState;
  patch: Readonly<Record<string, unknown>>;
  provided: (field: string) => boolean;
  note: (field: string, ...classes: StatusPageChangeClass[]) => void;
}): StatusPageRouteDelta {
  const { current, patch, provided, note } = args;
  const added: string[] = [];
  const removed: string[] = [];

  const routeKeyed = [
    { field: 'slug', key: (value: string) => value },
    { field: 'customDomain', key: (value: string) => `domain:${value.toLowerCase()}` },
    { field: 'subdomain', key: (value: string) => `subdomain:${value.toLowerCase()}` },
  ] as const;

  for (const { field, key } of routeKeyed) {
    if (!provided(field)) continue;
    const next = normalizeText(patch[field]);
    const before = normalizeText(current[field]);
    if (next === before) continue;
    note(field, 'ROUTING');
    if (next) added.push(key(next));
    if (before) removed.push(key(before));
  }

  if (provided('isDefault')) {
    const next = patch.isDefault === true;
    if (next !== (current.isDefault === true)) {
      note('isDefault', 'ROUTING');
      (next ? added : removed).push('default');
    }
  }

  return { added, removed };
}
