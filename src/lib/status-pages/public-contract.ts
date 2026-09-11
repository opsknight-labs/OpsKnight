export const PUBLIC_SERVICE_STATUSES = [
  'OPERATIONAL',
  'DEGRADED',
  'MAINTENANCE',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
  'UNKNOWN',
] as const;

export type PublicServiceStatus = (typeof PUBLIC_SERVICE_STATUSES)[number];
export type PublicHistoryStatus = PublicServiceStatus;

export interface PublicHistorySlice {
  startMinute: number;
  endMinute: number;
  status: PublicHistoryStatus;
}

export interface PublicStatusHistoryDay {
  date: string;
  status: PublicHistoryStatus;
  incidentCount: number;
  availabilityPercent: number | null;
  timeline?: PublicHistorySlice[];
}

export interface PublicStatusHistorySegment {
  startAt: string;
  endAt: string;
  status: Exclude<PublicServiceStatus, 'OPERATIONAL'>;
}

export interface PublicStatusHistory {
  rangeStart: string;
  rangeEnd: string;
  coverage: 'COMPLETE' | 'PARTIAL';
  segments: PublicStatusHistorySegment[];
}

/** How the backend grades an uptime figure against the page's own SLA thresholds. */
export type PublicUptimeGrade = 'EXCELLENT' | 'GOOD' | 'BELOW_TARGET';

export interface PublicUptimeWindow {
  percentage: number | null;
  incidentCount: number;
  measuredDays: number;
  complete: boolean;
  grade?: PublicUptimeGrade;
}

/** Typed SLA facts so no surface decides for itself what "Excellent" means. */
export interface PublicServiceSla {
  tier?: string | null;
  target?: number | null;
  grade?: PublicUptimeGrade;
}

export interface PublicStatusService {
  id: string;
  name: string;
  description?: string | null;
  regions?: string[];
  status: PublicServiceStatus;
  statusSince?: string;
  activeIncidentCount: number;
  team?: { id: string; name: string } | null;
  /** @deprecated Prefer `sla.tier`; retained for existing consumers. */
  slaTier?: string | null;
  sla?: PublicServiceSla;
  uptime?: { days30: PublicUptimeWindow; days90: PublicUptimeWindow };
  history?: PublicStatusHistory;
}

export interface PublicRegionStatus {
  name: string;
  status: PublicServiceStatus;
  totalServices: number;
  operationalServices: number;
  degradedServices: number;
  maintenanceServices: number;
  partialOutageServices: number;
  majorOutageServices: number;
  unknownServices: number;
  impactedServices: number;
  serviceIds: string[];
}

export type PublicIncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
export type PublicIncidentUrgency = 'LOW' | 'MEDIUM' | 'HIGH';
export type PublicIncidentUpdateType =
  | 'INVESTIGATING'
  | 'IDENTIFIED'
  | 'MONITORING'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'UPDATE';

export interface PublicIncidentUpdate {
  id: string;
  type: PublicIncidentUpdateType;
  message: string;
  createdAt?: string;
}

/** Coarse, public-safe impact so no surface reinterprets internal urgency. */
export type PublicIncidentImpact = 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE' | 'UNKNOWN';

/** Public reference to a published post-incident review. */
export interface PublicPostmortemRef {
  available: true;
  id: string;
  publishedAt?: string;
  title?: string;
  summary?: string;
}

export interface PublicIncident {
  id?: string;
  /** Opaque stable feed id. Present even when the raw incident id is withheld. */
  publicEventId?: string;
  title?: string;
  description?: string;
  status: PublicIncidentStatus;
  urgency?: PublicIncidentUrgency;
  publicImpact?: PublicIncidentImpact;
  createdAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  service?: { id?: string; name?: string; regions?: string[] };
  updates?: PublicIncidentUpdate[];
  /** @deprecated Prefer `postmortem`; retained for existing consumers. */
  postIncidentReview?: boolean;
  postmortem?: PublicPostmortemRef;
  /** Set when detail fields were redacted for privacy (older history). */
  redacted?: boolean;
}

/** Typed branding so the contract stops shipping `unknown`. */
export interface PublicStatusBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  metaTitle?: string;
  metaDescription?: string;
  customCss?: string;
  layout?: 'default' | 'compact' | 'wide';
  showHeader?: boolean;
  showFooter?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
  showApiLink?: boolean;
  showRssLink?: boolean;
}

/** Chrome and layout that the public renderer reads; kept in sync with branding. */
export interface PublicPagePresentation {
  layout?: 'default' | 'compact' | 'wide';
  showHeader?: boolean;
  showFooter?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
  showApiLink?: boolean;
  showRssLink?: boolean;
}

/** What this page's engine supports, independent of what the admin chose to show. */
export interface PublicPageCapabilities {
  services: boolean;
  serviceHistory: boolean;
  uptime: boolean;
  regions: boolean;
  incidents: boolean;
  incidentUpdates: boolean;
  postmortems: boolean;
  maintenance: boolean;
  announcements: boolean;
  changelog: boolean;
  subscriptions: boolean;
  rss: boolean;
  jsonApi: boolean;
  uptimeCsv: boolean;
  uptimePdf: boolean;
}

/** Which public resources exist for this page. Route generation stays outside the snapshot. */
export interface PublicResources {
  jsonApi: boolean;
  rss: boolean;
  uptimeCsv: boolean;
  uptimePdf: boolean;
  postmortems: boolean;
  subscriptions: boolean;
}

/** Forward-looking subscription capabilities so the contract need not be redesigned later. */
export interface PublicSubscriptionCapabilities {
  enabled: boolean;
  channels: string[];
  verificationRequired: boolean;
  serviceSelectionSupported: boolean;
}

export type PublicMaintenanceState = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED';

/** First-class maintenance, projected from announcements + affected-service data. */
export interface PublicMaintenance {
  id: string;
  title: string;
  description?: string;
  state: PublicMaintenanceState;
  startAt: string;
  endAt?: string | null;
  affectedServices?: Array<{ id: string; name: string }>;
  affectedRegions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicAnnouncement {
  id: string;
  title: string;
  message: string;
  type: string;
  startDate: string;
  endDate: string | null;
  affectedServices?: Array<{ id: string; name: string }>;
  affectedRegions?: string[];
}

export interface PublicChangelogEntry {
  id: string;
  title: string;
  message: string;
  publishedAt: string;
  affectedServices?: Array<{ id: string; name: string }>;
}

/** Truthful history availability, so the UI never claims more coverage than exists. */
export interface PublicRetention {
  requestedHistoryDays: number;
  availableHistoryDays: number;
  rangeStart: string;
  rangeEnd: string;
  coverage: 'COMPLETE' | 'PARTIAL';
}

/** Separates "snapshot generated" from "status last changed". */
export interface PublicFreshness {
  generatedAt: string;
  lastStatusChangeAt?: string;
  lastIncidentUpdateAt?: string;
  revision: string;
}

export interface PublicStatusPageSnapshot {
  schemaVersion: 3;
  pageId: string;
  revision: string;
  generatedAt: string;
  page: {
    id: string;
    name: string;
    organizationName?: string | null;
    branding?: PublicStatusBranding | null;
    presentation?: PublicPagePresentation;
    capabilities?: PublicPageCapabilities;
    resources?: PublicResources;
    subscription?: PublicSubscriptionCapabilities;
    showSubscribe: boolean;
    showServicesByRegion: boolean;
    showRegionHeatmap: boolean;
    showPostIncidentReview: boolean;
    showChangelog: boolean;
    visibility?: {
      services: boolean;
      incidents: boolean;
      metrics: boolean;
      uptime: boolean;
      regions: boolean;
      changelog: boolean;
      subscribe: boolean;
    };
    enableUptimeExports: boolean;
    footerText?: string | null;
    contactEmail?: string | null;
    contactUrl?: string | null;
    slug?: string | null;
    customDomain?: string | null;
    subdomain?: string | null;
    isDefault: boolean;
    requireAuth: boolean;
    enabled: boolean;
    statusApiRequireToken: boolean;
    statusApiRateLimitEnabled: boolean;
    statusApiRateLimitMax: number;
    statusApiRateLimitWindowSec: number;
  };
  status: PublicServiceStatus;
  /**
   * Worst-rank including UNKNOWN. Compatibility only; canonical `status` equals `overall.status`.
   */
  statusIncludingUnknown?: PublicServiceStatus;
  /**
   * Severity and data confidence reported separately, so a service we cannot verify neither
   * masks a real outage nor is silently counted as healthy.
   */
  overall: {
    status: PublicServiceStatus;
    statusSince?: string;
    knownServiceCount: number;
    unknownServiceCount: number;
    confidence: 'complete' | 'partial' | 'none';
    totalServiceCount?: number;
    impactedServiceCount?: number;
    activeIncidentCount?: number;
    maintenanceCount?: number;
    headline: string;
    note: string | null;
  };
  /** The page's own SLA thresholds, so every surface grades uptime the same way. */
  thresholds?: { uptimeExcellent: number; uptimeGood: number };
  services: PublicStatusService[];
  regions: PublicRegionStatus[];
  incidents: PublicIncident[];
  maintenance?: PublicMaintenance[];
  announcements: PublicAnnouncement[];
  changelog?: PublicChangelogEntry[];
  retention?: PublicRetention;
  freshness?: PublicFreshness;
  historyDays: number;
}
