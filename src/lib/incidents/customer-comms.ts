import 'server-only';
import prisma from '@/lib/prisma';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { deriveAnnouncementLifecycle } from '@/lib/status-pages/announcement-lifecycle';
import {
  getWorstPublicStatus,
  publicStatusForIncidentUrgency,
  STATUS_PRESENTATION,
} from '@/lib/status-pages/status-presentation';
import type { PublicServiceStatus } from '@/lib/status-pages/public-contract';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { STATUS_UPDATE_CADENCE_DEFAULT } from '@/lib/intelligence/helpers/status-draft-loader';
import type { ToneKey } from '@/components/patterns/status-tone';
import { logger } from '@/lib/logger';

/** Posts read for one incident; the card shows the newest few and discloses the rest. */
export const CUSTOMER_COMMS_POST_LIMIT = 20;
const COMPONENT_LIMIT = 20;
/** Open public incidents on the service, for the component state. */
const OPEN_INCIDENT_LIMIT = 50;

const PAGE_SELECT = {
  id: true,
  name: true,
  enabled: true,
  privacyMode: true,
  requireAuth: true,
  slug: true,
  isDefault: true,
  subdomain: true,
  customDomain: true,
  updateCadenceMinutes: true,
} as const;

export type CommsPage = {
  id: string;
  name: string;
  enabled: boolean;
  privacyMode: string | null;
  requireAuth: boolean;
  slug: string | null;
  isDefault: boolean;
  subdomain: string | null;
  customDomain: string | null;
  updateCadenceMinutes: number | null;
};

export type CustomerCommsRows = {
  incident: { id: string; status: string; visibility: string };
  /** Newest first (createdAt, id). */
  posts: Array<{
    id: string;
    title: string;
    message: string;
    type: string;
    isActive: boolean;
    startDate: Date;
    endDate: Date | null;
    publishAt: Date;
    createdAt: Date;
    statusPage: CommsPage;
  }>;
  /** The incident's service as a component on each page that shows it, by page id. */
  components: Array<{ displayName: string | null; serviceName: string; statusPage: CommsPage }>;
  /** Urgencies of the open public incidents on the incident's service. */
  openUrgencies: string[];
};

export type CustomerCommsPost = {
  id: string;
  pageName: string;
  kind: string;
  /** Null while the post is live on the page. */
  lifecycle: 'Draft' | 'Scheduled' | 'Ended' | null;
  at: string;
  title: string;
  firstLine: string;
  /** The whole update, for the hover card (capped). */
  message: string;
  href: string | null;
};

export type CustomerCommsView = {
  /** False: the incident has no post and its service is on no page the viewer may see. */
  linked: boolean;
  posts: CustomerCommsPost[];
  /** True when more posts exist than were read. */
  truncated: boolean;
  nextDue: { pageName: string; at: string; text: string; overdue: boolean } | null;
  components: Array<{
    key: string;
    name: string;
    pageName: string;
    label: string;
    tone: ToneKey;
  }>;
  /** "Post update" (publishers only, open public incidents, like the command bar). */
  postHref: string | null;
  /** "Set up" link in the empty state (publishers only). */
  setupHref: string | null;
};

const POST_KIND: Record<string, string> = {
  INCIDENT: 'Incident',
  MAINTENANCE: 'Maintenance',
  UPDATE: 'Update',
  WARNING: 'Warning',
  INFO: 'Information',
};

const COMPONENT_TONE: Record<PublicServiceStatus, ToneKey> = {
  OPERATIONAL: 'ok',
  DEGRADED: 'elevated',
  PARTIAL_OUTAGE: 'elevated',
  MAJOR_OUTAGE: 'critical',
  MAINTENANCE: 'info',
  UNKNOWN: 'neutral',
};

/** Anyone may see a page that is on and open to the public; private pages need the status-page read. */
export function isPublicPage(page: CommsPage): boolean {
  return page.enabled && !page.requireAuth && (page.privacyMode ?? 'PUBLIC') === 'PUBLIC';
}

/**
 * Same wording and rounding as `nextUpdateLabel` in StatusUpdateAction (a client module, so a server
 * component cannot call it): "Next update in 12m", "Update due now", "Update overdue by 5m".
 */
export function nextUpdateText(nextDueAt: Date, now: Date): { text: string; overdue: boolean } {
  const minutes = Math.round((nextDueAt.getTime() - now.getTime()) / 60_000);
  if (minutes > 0) return { text: `Next update in ${formatMinutes(minutes)}`, overdue: false };
  if (minutes === 0) return { text: 'Update due now', overdue: true };
  return { text: `Update overdue by ${formatMinutes(-minutes)}`, overdue: true };
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${minutes / 60}h`;
}

function firstLine(message: string): string {
  return (
    message
      .split('\n')
      .map(line => line.trim())
      .find(Boolean) ?? ''
  );
}

/** Pure: the rows the viewer may see, shaped for the card. No DB, no clock. */
export function shapeCustomerComms(
  rows: CustomerCommsRows,
  viewer: { canReadPages: boolean; canPublish: boolean },
  now: Date,
  publicUrl: (page: CommsPage) => string
): CustomerCommsView {
  const pageVisible = (page: CommsPage) => viewer.canReadPages || isPublicPage(page);
  const posts = rows.posts.filter(
    post =>
      pageVisible(post.statusPage) &&
      (viewer.canReadPages || deriveAnnouncementLifecycle({ ...post, now }).isPubliclyVisible)
  );
  const components = rows.components.filter(component => pageVisible(component.statusPage));

  const status: PublicServiceStatus = rows.openUrgencies.length
    ? getWorstPublicStatus(rows.openUrgencies.map(publicStatusForIncidentUrgency))
    : 'OPERATIONAL';
  const componentState = {
    // eslint-disable-next-line security/detect-object-injection -- status is a typed enum value, not user input
    label: STATUS_PRESENTATION[status].label,
    // eslint-disable-next-line security/detect-object-injection -- status is a typed enum value, not user input
    tone: COMPONENT_TONE[status],
  };

  // Like loadIncidentStatusUpdate: only open public incidents get a cadence; the page last posted on
  // wins, else the first page showing the service.
  const open =
    rows.incident.visibility === 'PUBLIC' &&
    ['OPEN', 'ACKNOWLEDGED'].includes(rows.incident.status);
  const last = posts[0];
  const targetPage = last?.statusPage ?? components[0]?.statusPage;
  let nextDue: CustomerCommsView['nextDue'] = null;
  if (open && last) {
    const cadence = last.statusPage.updateCadenceMinutes ?? STATUS_UPDATE_CADENCE_DEFAULT;
    const at = new Date(last.createdAt.getTime() + cadence * 60_000);
    nextDue = { pageName: last.statusPage.name, at: at.toISOString(), ...nextUpdateText(at, now) };
  }

  const linked = posts.length > 0 || components.length > 0;
  return {
    linked,
    posts: posts.map(post => {
      const lifecycle = deriveAnnouncementLifecycle({ ...post, now }).status;
      return {
        id: post.id,
        pageName: post.statusPage.name,
        kind: POST_KIND[post.type] ?? 'Update',
        lifecycle:
          lifecycle === 'DRAFT'
            ? 'Draft'
            : lifecycle === 'SCHEDULED'
              ? 'Scheduled'
              : lifecycle === 'CONCLUDED'
                ? 'Ended'
                : null,
        at: post.createdAt.toISOString(),
        title: post.title,
        firstLine: firstLine(post.message),
        message: post.message.trim().slice(0, 2000),
        href: post.statusPage.enabled ? publicUrl(post.statusPage) : null,
      };
    }),
    truncated: rows.posts.length >= CUSTOMER_COMMS_POST_LIMIT,
    nextDue,
    components: components.map(component => ({
      key: component.statusPage.id,
      name: component.displayName?.trim() || component.serviceName,
      pageName: component.statusPage.name,
      ...componentState,
    })),
    postHref:
      viewer.canPublish && open && targetPage
        ? `/settings/status-pages/${targetPage.id}?announce=${encodeURIComponent(rows.incident.id)}`
        : null,
    setupHref: viewer.canPublish && !linked ? '/settings/status-pages' : null,
  };
}

/** Thin DB read: three bounded, indexed queries. */
async function loadCustomerCommsRows(incident: {
  id: string;
  serviceId: string;
  status: string;
  visibility: string;
}): Promise<CustomerCommsRows> {
  const [posts, components] = await Promise.all([
    prisma.statusPageAnnouncement.findMany({
      where: { incidentId: incident.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CUSTOMER_COMMS_POST_LIMIT,
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isActive: true,
        startDate: true,
        endDate: true,
        publishAt: true,
        createdAt: true,
        statusPage: { select: PAGE_SELECT },
      },
    }),
    prisma.statusPageService.findMany({
      where: { serviceId: incident.serviceId, showOnPage: true },
      orderBy: [{ statusPageId: 'asc' }],
      take: COMPONENT_LIMIT,
      select: {
        displayName: true,
        service: { select: { name: true } },
        statusPage: { select: PAGE_SELECT },
      },
    }),
  ]);
  // shortcut: component state is derived from open public incidents (what the projector ranks first);
  // maintenance windows and the published snapshot are not read. Read the snapshot if they drift.
  const openIncidents = components.length
    ? await prisma.incident.findMany({
        where: {
          serviceId: incident.serviceId,
          visibility: 'PUBLIC',
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        take: OPEN_INCIDENT_LIMIT,
        select: { urgency: true },
      })
    : [];
  return {
    incident,
    posts,
    components: components.map(row => ({
      displayName: row.displayName,
      serviceName: row.service.name,
      statusPage: row.statusPage,
    })),
    openUrgencies: openIncidents.map(row => row.urgency),
  };
}

/**
 * What customers were told about this incident, for the incident page. The caller has already checked
 * that `actor` may read the incident. Private pages and unpublished posts need the status-page read;
 * "Post update" needs the status-page publish (admin). Null on any failure.
 */
export async function loadIncidentCustomerComms(
  actor: AuthorizationActor,
  incident: { id: string; serviceId: string; status: string; visibility: string },
  now: Date = new Date()
): Promise<CustomerCommsView | null> {
  try {
    const viewer = {
      canReadPages: authorize({ actor, action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ }).allowed,
      canPublish: authorize({ actor, action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE }).allowed,
    };
    const rows = await loadCustomerCommsRows(incident);
    return shapeCustomerComms(rows, viewer, now, page => getStatusPagePublicUrl(page));
  } catch (error) {
    logger.warn('incident.customer_comms.unavailable', { incidentId: incident.id, error });
    return null;
  }
}
