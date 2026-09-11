import 'dotenv/config';
import {
  PrismaClient,
  IncidentUrgency as PrismaIncidentUrgency,
  IncidentEventType,
  type Prisma,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

const seedConfig = {
  teams: 6,
  servicesPerTeam: 3,
  incidents: 36,
  usersPerTeam: 4,
  incidentHistoryDays: 120,
  slaSnapshotDays: 7,
};

const urgencyLevels = ['HIGH', 'MEDIUM', 'LOW'] as const;
type IncidentUrgency = (typeof urgencyLevels)[number];

const incidentStatuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'] as const;
type IncidentStatus = (typeof incidentStatuses)[number];

const serviceStatuses = ['OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'] as const;
type ServiceStatus = (typeof serviceStatuses)[number];

const notificationChannels = ['EMAIL', 'SMS', 'PUSH', 'SLACK', 'WEBHOOK', 'WHATSAPP'] as const;

const firstNames = [
  'Ava',
  'Noah',
  'Maya',
  'Leo',
  'Zoe',
  'Owen',
  'Nina',
  'Kai',
  'Ivy',
  'Jude',
  'Riya',
  'Miles',
];

const lastNames = [
  'Patel',
  'Nguyen',
  'Garcia',
  'Smith',
  'Khan',
  'Bose',
  'Kim',
  'Brown',
  'Lee',
  'Martinez',
];

const teamNames = [
  'Platform Engineering',
  'Security Operations',
  'Payments',
  'Customer Success',
  'Data & AI',
  'Mobile Reliability',
];

const serviceCatalog = [
  { name: 'API Gateway', tier: 'Gold' },
  { name: 'Auth Service', tier: 'Gold' },
  { name: 'Payment Processor', tier: 'Gold' },
  { name: 'Email Worker', tier: 'Silver' },
  { name: 'Search Indexer', tier: 'Silver' },
  { name: 'Analytics Pipeline', tier: 'Silver' },
  { name: 'User Profile DB', tier: 'Gold' },
  { name: 'Frontend CDN', tier: 'Gold' },
  { name: 'Backoffice UI', tier: 'Bronze' },
  { name: 'Inventory System', tier: 'Silver' },
  { name: 'Recommendation Engine', tier: 'Silver' },
  { name: 'Notification Service', tier: 'Gold' },
];

const incidentScenarios = [
  { title: 'High Latency', desc: 'Response times exceeding 500ms SLA' },
  { title: 'Database Connection Timeout', desc: 'Connection pool exhausted' },
  { title: '5xx Error Spike', desc: 'Elevated 500/502 errors detected' },
  { title: 'Memory Leak', desc: 'Container memory usage > 90%' },
  { title: 'Certificate Expiration', desc: 'SSL certificate expiring in 24h' },
  { title: 'Disk Space Low', desc: 'Root partition above 95% capacity' },
  { title: 'Queue Backlog', desc: 'Message processing lag > 5 minutes' },
  { title: 'Third-party API Down', desc: 'Payment provider API returning 503' },
  { title: 'Frontend Crash', desc: 'JS error rate spike in production' },
  { title: 'Login Failure', desc: 'Users unable to authenticate via OAuth' },
];

const tags = [
  { name: 'network', color: '#2563eb' },
  { name: 'database', color: '#16a34a' },
  { name: 'latency', color: '#f59e0b' },
  { name: 'security', color: '#dc2626' },
  { name: 'third-party', color: '#7c3aed' },
];

let seedState = 20250109;
function seededRandom() {
  seedState = (seedState * 48271) % 2147483647;
  return seedState / 2147483647;
}

function randomInt(max: number) {
  return Math.floor(seededRandom() * max);
}

function randomPick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}

function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function hoursAgo(hours: number) {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d;
}

function minutesFrom(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}

function clampToNow(date: Date) {
  const now = new Date();
  if (date > now) return new Date(now.getTime() - 1000);
  return date;
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashSecret(value: string) {
  // Use bcrypt for credential-like values to increase computational effort.
  const saltRounds = 10;
  return bcrypt.hashSync(value, saltRounds);
}

async function createPublicCatalogIncident(input: {
  serviceId: string;
  teamId: string;
  adminId: string;
  title: string;
  description: string;
  status: IncidentStatus;
  urgency: IncidentUrgency;
  createdHoursAgo: number;
  visibility?: 'PUBLIC' | 'PRIVATE';
  withPostmortem?: boolean;
}) {
  const createdAt = hoursAgo(input.createdHoursAgo);
  const acknowledgedAt =
    input.status === 'OPEN'
      ? null
      : clampToNow(minutesFrom(createdAt, input.urgency === 'HIGH' ? 4 : 18));
  const resolvedAt =
    input.status === 'RESOLVED'
      ? clampToNow(minutesFrom(acknowledgedAt ?? createdAt, input.urgency === 'HIGH' ? 95 : 180))
      : null;
  const incident = await prisma.incident.create({
    data: {
      title: input.title,
      description: input.description,
      status: input.status,
      urgency: input.urgency,
      visibility: input.visibility ?? 'PUBLIC',
      priority: input.urgency === 'HIGH' ? 'P1' : input.urgency === 'MEDIUM' ? 'P2' : 'P3',
      serviceId: input.serviceId,
      teamId: input.teamId,
      dedupKey: `status-catalog-${input.serviceId}-${input.title}`,
      slaAckTargetMs: input.urgency === 'HIGH' ? 5 * 60_000 : 15 * 60_000,
      slaResolveTargetMs: input.urgency === 'HIGH' ? 60 * 60_000 : 240 * 60_000,
      slaTargetSource: 'service',
      slaTargetCapturedAt: createdAt,
      createdAt,
      updatedAt: resolvedAt ?? acknowledgedAt ?? createdAt,
      acknowledgedAt,
      resolvedAt,
    },
  });
  await prisma.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: IncidentEventType.STATUS_CHANGE,
      message: 'Incident triggered from monitoring',
      createdAt,
    },
  });
  if (acknowledgedAt) {
    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: IncidentEventType.ACKNOWLEDGED,
        message: 'On-call acknowledged and started mitigation',
        createdAt: acknowledgedAt,
      },
    });
  }
  if (resolvedAt) {
    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: IncidentEventType.MANUAL_RESOLVED,
        message: 'Service recovered; monitoring is green',
        createdAt: resolvedAt,
      },
    });
    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: IncidentEventType.COMMENT,
        message: 'Customer-facing update: impact contained to a single region.',
        createdAt: minutesFrom(resolvedAt, -20),
      },
    });
  }
  if (input.withPostmortem && resolvedAt) {
    await prisma.postmortem.create({
      data: {
        incidentId: incident.id,
        title: `Post-incident review: ${input.title}`,
        summary: 'Public review of customer impact, detection, and recovery.',
        rootCause: 'Saturated connection pool in the primary region during a traffic spike.',
        resolution: 'Scaled the pool and added saturation alerts.',
        impact: { customers: '8%', durationMinutes: 95, regions: ['us-east-1'] },
        lessons: 'Saturation alerts must fire before checkout error rate climbs.',
        status: 'PUBLISHED',
        isPublic: true,
        publishedAt: minutesFrom(resolvedAt, 30),
        createdById: input.adminId,
      },
    });
  }
  return incident;
}

async function seedPublicStatusSurface(input: {
  adminId: string;
  teams: Array<{ id: string }>;
  policies: Array<{ id: string; teamId: string }>;
  services: Array<{ id: string; name: string; teamId: string }>;
}) {
  const showcaseSpecs = [
    {
      name: 'Checkout API',
      description: 'Card authorization and order capture.',
      region: 'us-east-1',
      slaTier: 'Gold',
      teamIndex: 0,
    },
    {
      name: 'Identity Gateway',
      description: 'SSO, session minting, and MFA challenges.',
      region: 'eu-west-1',
      slaTier: 'Gold',
      teamIndex: 1,
    },
    {
      name: 'Payments Ledger',
      description: 'Ledger writes replicated across two continents.',
      region: 'us-west-2, eu-central-1',
      slaTier: 'Gold',
      teamIndex: 2,
    },
    {
      name: 'Global CDN',
      description: 'Static assets and edge cache.',
      region: 'ap-south-1',
      slaTier: 'Gold',
      teamIndex: 3,
    },
    {
      name: 'Search Cluster',
      description: 'Product and knowledge-base search.',
      region: 'us-east-1, eu-west-1',
      slaTier: 'Silver',
      teamIndex: 4,
    },
    {
      name: 'Notification Hub',
      description: 'Email, SMS, and push fan-out.',
      region: 'ap-northeast-1',
      slaTier: 'Bronze',
      teamIndex: 5,
    },
  ] as const;

  const showcase: Array<{ id: string; name: string; teamId: string }> = [];
  for (const spec of showcaseSpecs) {
    const team = input.teams[spec.teamIndex] ?? input.teams[0];
    const policy = input.policies.find(item => item.teamId === team.id);
    const service = await prisma.service.create({
      data: {
        name: spec.name,
        description: spec.description,
        status: 'OPERATIONAL',
        region: spec.region,
        slaTier: spec.slaTier,
        teamId: team.id,
        escalationPolicyId: policy?.id,
        targetAckMinutes: spec.slaTier === 'Gold' ? 5 : spec.slaTier === 'Silver' ? 15 : 30,
        targetResolveMinutes: spec.slaTier === 'Gold' ? 60 : spec.slaTier === 'Silver' ? 240 : 480,
        defaultIncidentVisibility: 'PUBLIC',
      },
    });
    showcase.push({ id: service.id, name: service.name, teamId: team.id });
  }

  const checkout = showcase[0];
  const identity = showcase[1];
  const payments = showcase[2];
  const search = showcase[4];
  const notifications = showcase[5];

  const major = await createPublicCatalogIncident({
    serviceId: checkout.id,
    teamId: checkout.teamId,
    adminId: input.adminId,
    title: 'Checkout API: card authorization timeouts',
    description:
      'Customers in us-east-1 cannot complete payment. Authorization calls to the card network are timing out after 8s.',
    status: 'OPEN',
    urgency: 'HIGH',
    createdHoursAgo: 2,
  });
  await createPublicCatalogIncident({
    serviceId: checkout.id,
    teamId: checkout.teamId,
    adminId: input.adminId,
    title: 'Internal: payment-provider secret rotation',
    description: 'Must not appear on the public status page.',
    status: 'OPEN',
    urgency: 'HIGH',
    createdHoursAgo: 1,
    visibility: 'PRIVATE',
  });
  await createPublicCatalogIncident({
    serviceId: identity.id,
    teamId: identity.teamId,
    adminId: input.adminId,
    title: 'Identity Gateway: slower MFA challenge delivery',
    description:
      'SMS MFA codes are delayed by 20–40 seconds in eu-west-1. Password login is unaffected.',
    status: 'ACKNOWLEDGED',
    urgency: 'LOW',
    createdHoursAgo: 5,
  });
  await createPublicCatalogIncident({
    serviceId: payments.id,
    teamId: payments.teamId,
    adminId: input.adminId,
    title: 'Payments Ledger: elevated write latency in us-west-2',
    description: 'P95 ledger writes are above the regional SLO. eu-central-1 remains healthy.',
    status: 'OPEN',
    urgency: 'MEDIUM',
    createdHoursAgo: 3,
  });
  await createPublicCatalogIncident({
    serviceId: search.id,
    teamId: search.teamId,
    adminId: input.adminId,
    title: 'Search Cluster: index rebuild caused empty results',
    description: 'A rolling reindex briefly returned zero hits for catalog queries.',
    status: 'RESOLVED',
    urgency: 'HIGH',
    createdHoursAgo: 40,
    withPostmortem: true,
  });

  const statusPage = await prisma.statusPage.create({
    data: {
      name: 'OpsKnight Public Status',
      slug: 'status',
      organizationName: 'OpsKnight Labs',
      subdomain: 'status-opsknight',
      enabled: true,
      isDefault: true,
      showServices: true,
      showIncidents: true,
      showMetrics: true,
      showSubscribe: true,
      showServicesByRegion: true,
      showRegionHeatmap: true,
      showServiceDescriptions: true,
      showServiceRegions: true,
      showServiceOwners: true,
      showServiceSlaTier: true,
      showTeamInformation: true,
      showUptimeHistory: true,
      showChangelog: true,
      showPostIncidentReview: true,
      enableUptimeExports: true,
      showIncidentUrgency: true,
      showIncidentDetails: true,
      showIncidentDescriptions: true,
      showIncidentTimestamps: true,
      showAffectedServices: true,
      showRecentIncidents: true,
      showCustomFields: false,
      incidentHistoryDays: 90,
      maxIncidentsToShow: 50,
      uptimeExcellentThreshold: 99.9,
      uptimeGoodThreshold: 99.0,
      footerText: 'All systems are actively monitored.',
      contactEmail: 'status@example.com',
      contactUrl: 'https://opsknight.com/',
      branding: {
        logoUrl: '/logo.png',
        primaryColor: '#e11d48',
        backgroundColor: '#ffffff',
        textColor: '#0f172a',
        layout: 'wide',
        showHeader: true,
        showFooter: true,
        autoRefresh: true,
        refreshInterval: 60,
        showApiLink: true,
        showRssLink: true,
        metaTitle: 'OpsKnight Status',
        metaDescription: 'Live operational status for OpsKnight Labs services.',
      },
    },
  });

  const ordered = [...showcase, ...input.services];
  for (const [index, service] of ordered.entries()) {
    await prisma.statusPageService.create({
      data: {
        statusPageId: statusPage.id,
        serviceId: service.id,
        displayName: service.name,
        order: index,
        showOnPage: true,
      },
    });
  }

  const announcements: Prisma.StatusPageAnnouncementCreateManyInput[] = [
    {
      statusPageId: statusPage.id,
      title: 'Checkout disruption',
      message:
        'We are mitigating card-authorization timeouts in us-east-1. Alternate payment methods may still succeed.',
      type: 'INCIDENT',
      incidentId: major.id,
      affectedServiceIds: [checkout.id],
      startDate: hoursAgo(2),
      endDate: hoursAgo(-6),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Elevated API latency',
      message: 'A subset of requests may take longer than usual while mitigation is in progress.',
      type: 'WARNING',
      affectedServiceIds: [identity.id, payments.id],
      startDate: hoursAgo(1),
      endDate: hoursAgo(-5),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Office network maintenance notice',
      message:
        'This informational banner does not change service health. VPN users may see brief reconnects.',
      type: 'INFO',
      startDate: hoursAgo(3),
      endDate: hoursAgo(-12),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Notification Hub database failover',
      message:
        'In-progress maintenance on the notification datastore. Delivery delays of up to 10 minutes are expected.',
      type: 'MAINTENANCE',
      affectedServiceIds: [notifications.id],
      startDate: hoursAgo(1),
      endDate: hoursAgo(-3),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Global CDN certificate rotation',
      message: 'Upcoming edge certificate rotation. No customer impact is expected.',
      type: 'MAINTENANCE',
      affectedServiceIds: [showcase[3].id],
      startDate: hoursAgo(-6),
      endDate: hoursAgo(-10),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Search Cluster storage expansion',
      message: 'Completed capacity expansion in us-east-1 and eu-west-1.',
      type: 'MAINTENANCE',
      affectedServiceIds: [search.id],
      startDate: hoursAgo(96),
      endDate: hoursAgo(90),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Withdrawn Payments window',
      message: 'This maintenance was cancelled and must not affect current health.',
      type: 'MAINTENANCE',
      affectedServiceIds: [payments.id],
      startDate: hoursAgo(1),
      endDate: hoursAgo(-4),
      isActive: false,
    },
    {
      statusPageId: statusPage.id,
      title: 'Reliability improvements shipped',
      message:
        'Expanded regional capacity, tighter SLA cards, and more precise status-history segments.',
      type: 'UPDATE',
      affectedServiceIds: showcase.slice(0, 4).map(service => service.id),
      startDate: hoursAgo(18),
      endDate: hoursAgo(-72),
      isActive: true,
    },
    {
      statusPageId: statusPage.id,
      title: 'Status subscriptions: RSS and JSON API',
      message: 'Public RSS and JSON feeds are enabled on this page for status automation.',
      type: 'UPDATE',
      startDate: hoursAgo(72),
      endDate: hoursAgo(-24),
      isActive: true,
    },
  ];
  await prisma.statusPageAnnouncement.createMany({ data: announcements });

  const statusTokenRaw = `status-token-${Date.now()}`;
  await prisma.statusPageApiToken.create({
    data: {
      statusPageId: statusPage.id,
      name: 'Status API',
      prefix: statusTokenRaw.slice(0, 8),
      tokenHash: sha256(statusTokenRaw),
    },
  });

  await prisma.statusPageSubscription.create({
    data: {
      statusPageId: statusPage.id,
      email: 'status-updates@example.com',
      token: sha256('status-subscription'),
      verified: true,
      state: 'ACTIVE',
      verificationToken: sha256('status-verify'),
      preferences: { incidents: 'all' },
    },
  });

  await prisma.statusPageWebhook.create({
    data: {
      statusPageId: statusPage.id,
      url: 'https://example.com/status/webhook',
      secret: sha256('status-webhook-secret'),
      events: ['incident.created', 'incident.updated', 'incident.resolved'],
      enabled: true,
    },
  });

  await publishSeededStatusPage(statusPage.id, 'default');

  await seedHealthyStatusPage({
    adminId: input.adminId,
    teams: input.teams,
    policies: input.policies,
  });
  await seedDegradedStatusPage({
    adminId: input.adminId,
    teams: input.teams,
    policies: input.policies,
  });

  return statusPage;
}

const seedStatusPagePresentation = {
  enabled: true,
  showServices: true,
  showIncidents: true,
  showMetrics: true,
  showSubscribe: true,
  showServicesByRegion: true,
  showRegionHeatmap: true,
  showServiceDescriptions: true,
  showServiceRegions: true,
  showServiceOwners: true,
  showServiceSlaTier: true,
  showTeamInformation: true,
  showUptimeHistory: true,
  showChangelog: true,
  showPostIncidentReview: true,
  enableUptimeExports: true,
  showIncidentUrgency: true,
  showIncidentDetails: true,
  showIncidentDescriptions: true,
  showIncidentTimestamps: true,
  showAffectedServices: true,
  showRecentIncidents: true,
  showCustomFields: false,
  incidentHistoryDays: 90,
  maxIncidentsToShow: 50,
  uptimeExcellentThreshold: 99.9,
  uptimeGoodThreshold: 99.0,
} as const;

async function publishSeededStatusPage(statusPageId: string, label: string) {
  try {
    const { rebuildStatusPageSnapshot } = await import('../src/lib/status-pages/snapshot');
    const published = await rebuildStatusPageSnapshot(statusPageId);
    process.stdout.write(
      published
        ? `Published ${label} status snapshot.\n`
        : `Status snapshot for ${label} was not published; open the page after the app starts.\n`
    );
  } catch (error) {
    process.stdout.write(
      `Could not publish ${label} status snapshot from seed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

async function createDedicatedCatalogServices(
  specs: ReadonlyArray<{
    name: string;
    description: string;
    region: string;
    slaTier: 'Gold' | 'Silver' | 'Bronze';
    teamIndex: number;
  }>,
  teams: Array<{ id: string }>,
  policies: Array<{ id: string; teamId: string }>
) {
  const created: Array<{ id: string; name: string; teamId: string }> = [];
  for (const spec of specs) {
    const team = teams[spec.teamIndex] ?? teams[0];
    const policy = policies.find(item => item.teamId === team.id);
    const service = await prisma.service.create({
      data: {
        name: spec.name,
        description: spec.description,
        status: 'OPERATIONAL',
        region: spec.region,
        slaTier: spec.slaTier,
        teamId: team.id,
        escalationPolicyId: policy?.id,
        targetAckMinutes: spec.slaTier === 'Gold' ? 5 : spec.slaTier === 'Silver' ? 15 : 30,
        targetResolveMinutes: spec.slaTier === 'Gold' ? 60 : spec.slaTier === 'Silver' ? 240 : 480,
        defaultIncidentVisibility: 'PUBLIC',
      },
    });
    created.push({ id: service.id, name: service.name, teamId: team.id });
  }
  return created;
}

async function attachServicesToStatusPage(
  statusPageId: string,
  services: Array<{ id: string; name: string }>
) {
  for (const [index, service] of services.entries()) {
    await prisma.statusPageService.create({
      data: {
        statusPageId,
        serviceId: service.id,
        displayName: service.name,
        order: index,
        showOnPage: true,
      },
    });
  }
}

/** Isolated all-green page so the public strip can be reviewed without the mixed outage catalog. */
async function seedHealthyStatusPage(input: {
  adminId: string;
  teams: Array<{ id: string }>;
  policies: Array<{ id: string; teamId: string }>;
}) {
  const services = await createDedicatedCatalogServices(
    [
      {
        name: 'Docs Portal',
        description: 'Public documentation and changelog.',
        region: 'us-east-1',
        slaTier: 'Gold',
        teamIndex: 0,
      },
      {
        name: 'Billing Portal',
        description: 'Invoices, plans, and payment methods.',
        region: 'us-west-2',
        slaTier: 'Gold',
        teamIndex: 2,
      },
      {
        name: 'Image Pipeline',
        description: 'Asset transcoding and CDN origin.',
        region: 'eu-west-1',
        slaTier: 'Silver',
        teamIndex: 1,
      },
      {
        name: 'Audit Export',
        description: 'Compliance log export jobs.',
        region: 'eu-central-1',
        slaTier: 'Silver',
        teamIndex: 4,
      },
    ],
    input.teams,
    input.policies
  );

  const statusPage = await prisma.statusPage.create({
    data: {
      name: 'OpsKnight Healthy Status',
      slug: 'healthy',
      organizationName: 'OpsKnight Labs',
      subdomain: 'status-healthy',
      isDefault: false,
      footerText: 'All monitored services are operating normally.',
      contactEmail: 'status@example.com',
      contactUrl: 'https://opsknight.com/',
      branding: {
        logoUrl: '/logo.png',
        primaryColor: '#059669',
        backgroundColor: '#ffffff',
        textColor: '#0f172a',
        layout: 'wide',
        showHeader: true,
        showFooter: true,
        autoRefresh: true,
        refreshInterval: 60,
        showApiLink: true,
        showRssLink: true,
        metaTitle: 'OpsKnight Healthy Status',
        metaDescription: 'All-green demo status page for OpsKnight Labs.',
      },
      ...seedStatusPagePresentation,
    },
  });

  await attachServicesToStatusPage(statusPage.id, services);
  await prisma.statusPageAnnouncement.create({
    data: {
      statusPageId: statusPage.id,
      title: 'Reliability improvements shipped',
      message: 'Capacity and failover work is complete. No customer impact.',
      type: 'UPDATE',
      startDate: hoursAgo(26),
      endDate: hoursAgo(-48),
      isActive: true,
    },
  });
  await publishSeededStatusPage(statusPage.id, 'healthy');
}

/**
 * Isolated elevated page: one public MEDIUM incident.
 * V3 maps MEDIUM → partial outage (LOW is degraded, HIGH is major).
 */
async function seedDegradedStatusPage(input: {
  adminId: string;
  teams: Array<{ id: string }>;
  policies: Array<{ id: string; teamId: string }>;
}) {
  const services = await createDedicatedCatalogServices(
    [
      {
        name: 'Catalog Browse',
        description: 'Product listing and filters.',
        region: 'us-east-1',
        slaTier: 'Gold',
        teamIndex: 0,
      },
      {
        name: 'Recommendation Ranker',
        description: 'Personalized ranking and similar-item lookup.',
        region: 'us-east-1, eu-west-1',
        slaTier: 'Silver',
        teamIndex: 4,
      },
      {
        name: 'Account Settings',
        description: 'Profile, sessions, and notification preferences.',
        region: 'eu-west-1',
        slaTier: 'Gold',
        teamIndex: 1,
      },
      {
        name: 'Support Inbox',
        description: 'Ticket intake and agent console.',
        region: 'ap-south-1',
        slaTier: 'Bronze',
        teamIndex: 3,
      },
    ],
    input.teams,
    input.policies
  );

  const ranker = services[1];
  await createPublicCatalogIncident({
    serviceId: ranker.id,
    teamId: ranker.teamId,
    adminId: input.adminId,
    title: 'Recommendation Ranker: elevated ranking latency',
    description:
      'Personalized ranking P95 is above SLO in us-east-1. Browse and checkout are unaffected; similar-item widgets may load slowly.',
    status: 'OPEN',
    urgency: 'MEDIUM',
    createdHoursAgo: 4,
  });

  const statusPage = await prisma.statusPage.create({
    data: {
      name: 'OpsKnight Degraded Status',
      slug: 'degraded',
      organizationName: 'OpsKnight Labs',
      subdomain: 'status-degraded',
      isDefault: false,
      footerText: 'One service is operating below target.',
      contactEmail: 'status@example.com',
      contactUrl: 'https://opsknight.com/',
      branding: {
        logoUrl: '/logo.png',
        primaryColor: '#d97706',
        backgroundColor: '#ffffff',
        textColor: '#0f172a',
        layout: 'wide',
        showHeader: true,
        showFooter: true,
        autoRefresh: true,
        refreshInterval: 60,
        showApiLink: true,
        showRssLink: true,
        metaTitle: 'OpsKnight Degraded Status',
        metaDescription: 'Medium-urgency demo status page for OpsKnight Labs.',
      },
      ...seedStatusPagePresentation,
    },
  });

  await attachServicesToStatusPage(statusPage.id, services);
  await prisma.statusPageAnnouncement.create({
    data: {
      statusPageId: statusPage.id,
      title: 'Slower recommendations',
      message:
        'Ranking latency is elevated. Catalog browse remains available while we tune the ranker.',
      type: 'WARNING',
      affectedServiceIds: [ranker.id],
      startDate: hoursAgo(4),
      endDate: hoursAgo(-8),
      isActive: true,
    },
  });
  await publishSeededStatusPage(statusPage.id, 'degraded');
}

async function clearDatabase() {
  const deleteOperations: Prisma.PrismaPromise<unknown>[] = [
    prisma.statusPageWebhook.deleteMany(),
    prisma.statusPageSubscriptionToken.deleteMany(),
    prisma.statusPageSubscription.deleteMany(),
    prisma.statusPageApiToken.deleteMany(),
    prisma.statusPageAnnouncement.deleteMany(),
    prisma.statusPageRouteOperation.deleteMany(),
    prisma.statusPageAsset.deleteMany(),
    prisma.statusPageSnapshot.deleteMany(),
    prisma.statusPageService.deleteMany(),
    prisma.statusPage.deleteMany(),
    prisma.sLASnapshot.deleteMany(),
    prisma.sLADefinition.deleteMany(),
    prisma.sLAPerformanceLog.deleteMany(),
    prisma.incidentMetricRollup.deleteMany(),
    prisma.metricRollup.deleteMany(),
    prisma.logEntry.deleteMany(),
    prisma.backgroundJob.deleteMany(),
    prisma.customFieldValue.deleteMany(),
    prisma.customField.deleteMany(),
    prisma.inAppNotification.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.incidentWatcher.deleteMany(),
    prisma.incidentTag.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.incidentNote.deleteMany(),
    prisma.incidentEvent.deleteMany(),
    prisma.postmortem.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.webhookIntegration.deleteMany(),
    prisma.slackIntegration.deleteMany(),
    prisma.incidentTemplate.deleteMany(),
    prisma.service.deleteMany(),
    prisma.escalationRule.deleteMany(),
    prisma.escalationPolicy.deleteMany(),
    prisma.onCallShift.deleteMany(),
    prisma.onCallOverride.deleteMany(),
    prisma.onCallLayerUser.deleteMany(),
    prisma.onCallLayer.deleteMany(),
    prisma.onCallSchedule.deleteMany(),
    prisma.teamMember.deleteMany(),
    prisma.team.deleteMany(),
    prisma.apiKey.deleteMany(),
    prisma.userDevice.deleteMany(),
    prisma.userToken.deleteMany(),
    prisma.notificationProvider.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.oidcIdentity.deleteMany(),
    prisma.oidcConfig.deleteMany(),
    prisma.slackOAuthConfig.deleteMany(),
    prisma.systemSettings.deleteMany(),
    prisma.systemConfig.deleteMany(),
    prisma.user.deleteMany(),
  ];

  await prisma.$transaction(deleteOperations);
}

async function main() {
  process.stdout.write('Seeding OpsKnight demo data...\n');

  await clearDatabase();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'System Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
      timeZone: 'UTC',
      emailNotificationsEnabled: true,
    },
  });

  const seededUsers: Array<{ id: string; name: string; email: string; status: string }> = [
    { id: admin.id, name: admin.name, email: admin.email, status: admin.status },
  ];

  for (let i = 0; i < seedConfig.teams * seedConfig.usersPerTeam; i++) {
    const firstName = randomPick(firstNames);
    const lastName = randomPick(lastNames);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(99)}@example.com`;
    const isInvited = i % 9 === 0 && i !== 0;

    const user = await prisma.user.create({
      data: {
        name: `${firstName} ${lastName}`,
        email,
        role: i % 5 === 0 ? 'RESPONDER' : 'USER',
        status: isInvited ? 'INVITED' : 'ACTIVE',
        passwordHash: isInvited ? null : passwordHash,
        timeZone: i % 2 === 0 ? 'UTC' : 'America/New_York',
        emailNotificationsEnabled: i % 2 === 0,
        smsNotificationsEnabled: i % 4 === 0,
        pushNotificationsEnabled: i % 3 === 0,
        phoneNumber: i % 4 === 0 ? `+1555${randomInt(9000000) + 1000000}` : null,
        department: i % 3 === 0 ? 'Engineering' : 'Operations',
        jobTitle: i % 4 === 0 ? 'On-Call Lead' : 'SRE',
        avatarUrl: i % 5 === 0 ? `https://i.pravatar.cc/150?img=${i + 1}` : null,
      },
    });

    seededUsers.push({ id: user.id, name: user.name, email: user.email, status: user.status });
  }

  function encryptWithKey(text: string, keyHex: string) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  const seedKey = sha256('seed-encryption-key').slice(0, 64);
  const canaryValue = 'OPS_KNIGHT_CRYPTO_CHECK';
  const encryptedCanary = encryptWithKey(canaryValue, seedKey);

  await prisma.slackOAuthConfig.create({
    data: {
      clientId: '1234567890.1234567890',
      clientSecret: encryptWithKey('slack-oauth-secret', seedKey),
      redirectUri: 'https://localhost:3000/api/slack/callback',
      enabled: true,
      updatedBy: admin.id,
    },
  });

  await prisma.oidcConfig.create({
    data: {
      issuer: 'https://login.example.com',
      clientId: 'opsknight-demo',
      clientSecret: encryptWithKey('oidc-secret', seedKey),
      enabled: true,
      autoProvision: true,
      allowedDomains: ['example.com'],
      roleMapping: [{ claim: 'role', value: 'admin', role: 'ADMIN' }],
      customScopes: 'openid profile email groups',
      providerType: 'okta',
      providerLabel: 'Example Okta',
      profileMapping: { department: 'dept', jobTitle: 'title', avatarUrl: 'picture' },
      updatedBy: admin.id,
    },
  });

  await prisma.notificationProvider.createMany({
    data: [
      {
        provider: 'resend',
        enabled: true,
        config: {
          apiKey: encryptWithKey('resend-key', seedKey),
          sender: 'OpsKnight <noreply@example.com>',
        },
        updatedBy: admin.id,
      },
      {
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'ACXXXXX',
          authToken: encryptWithKey('twilio-token', seedKey),
          from: '+15551234567',
        },
        updatedBy: admin.id,
      },
    ],
  });

  await prisma.systemSettings.create({
    data: {
      appUrl: 'https://opsknight.local',
      encryptionKey: seedKey,
      incidentRetentionDays: 365,
      alertRetentionDays: 180,
      metricsRetentionDays: 180,
      realTimeWindowDays: 60,
    },
  });

  await prisma.systemConfig.createMany({
    data: [
      {
        key: 'encryption_fingerprint',
        value: { fingerprint: sha256('seed-key') },
        updatedBy: admin.id,
      },
      {
        key: 'encryption_canary',
        value: { encrypted: encryptedCanary },
        updatedBy: admin.id,
      },
      {
        key: 'feature_flags',
        value: { statusPageV2: true, pagerRotation: true },
        updatedBy: admin.id,
      },
    ],
  });

  const teams: Array<{ id: string; name: string; leadId: string }> = [];
  const teamMembers: Array<{ teamId: string; userId: string }> = [];

  for (let i = 0; i < seedConfig.teams; i++) {
    const team = await prisma.team.create({
      data: {
        name: teamNames.at(i) ?? `Team ${i + 1}`,
        description: `Responsible for ${teamNames.at(i) ?? `Team ${i + 1}`} services`,
      },
    });

    const teamUsers = seededUsers.slice(
      1 + i * seedConfig.usersPerTeam,
      1 + (i + 1) * seedConfig.usersPerTeam
    );
    const lead = teamUsers[0];

    for (const [index, member] of teamUsers.entries()) {
      teamMembers.push({ teamId: team.id, userId: member.id });
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: member.id,
          role: index === 0 ? 'OWNER' : index === 1 ? 'ADMIN' : 'MEMBER',
        },
      });
    }

    await prisma.team.update({ where: { id: team.id }, data: { teamLeadId: lead.id } });
    teams.push({ id: team.id, name: team.name, leadId: lead.id });
  }

  await prisma.oidcIdentity.create({
    data: {
      issuer: 'https://login.example.com',
      subject: 'user-001',
      email: seededUsers[1]?.email ?? 'user@example.com',
      userId: seededUsers[1]?.id ?? admin.id,
    },
  });

  const schedules: Array<{ id: string; teamId: string; layerUserIds: string[] }> = [];

  for (const team of teams) {
    const members = teamMembers
      .filter(member => member.teamId === team.id)
      .map(member => member.userId);
    const schedule = await prisma.onCallSchedule.create({
      data: {
        name: `${team.name} Primary On-Call`,
        timeZone: 'UTC',
        layers: {
          create: [
            {
              name: 'Primary',
              start: daysAgo(30),
              rotationLengthHours: 24,
              users: {
                create: members.map((userId, index) => ({ userId, position: index })),
              },
            },
            {
              name: 'Secondary',
              start: daysAgo(30),
              rotationLengthHours: 24,
              users: {
                create: members.map((userId, index) => ({ userId, position: index })),
              },
            },
          ],
        },
      },
      include: { layers: { include: { users: true } } },
    });

    const layerUserIds = schedule.layers.flatMap(layer => layer.users.map(user => user.userId));
    schedules.push({ id: schedule.id, teamId: team.id, layerUserIds });

    for (let day = 0; day < 14; day++) {
      const start = minutesFrom(daysAgo(14 - day), 0);
      const end = minutesFrom(start, 24 * 60);
      const userId = members[day % members.length] ?? team.leadId;
      await prisma.onCallShift.create({ data: { scheduleId: schedule.id, userId, start, end } });
    }

    await prisma.onCallOverride.create({
      data: {
        scheduleId: schedule.id,
        userId: members[1] ?? team.leadId,
        replacesUserId: members[0] ?? team.leadId,
        start: hoursAgo(6),
        end: hoursAgo(-6),
      },
    });
  }

  const policies: Array<{ id: string; teamId: string }> = [];

  for (const schedule of schedules) {
    const team = teams.find(item => item.id === schedule.teamId);
    if (!team) continue;

    const policy = await prisma.escalationPolicy.create({
      data: {
        name: `${team.name} Escalation Policy`,
        description: `Standard escalation policy for ${team.name}`,
        steps: {
          create: [
            {
              stepOrder: 0,
              delayMinutes: 0,
              targetType: 'SCHEDULE',
              targetScheduleId: schedule.id,
              notificationChannels: ['SLACK', 'EMAIL'],
            },
            {
              stepOrder: 1,
              delayMinutes: 10,
              targetType: 'USER',
              targetUserId: team.leadId,
              notificationChannels: ['SMS', 'PUSH'],
            },
            {
              stepOrder: 2,
              delayMinutes: 20,
              targetType: 'TEAM',
              targetTeamId: team.id,
              notificationChannels: ['EMAIL'],
              notifyOnlyTeamLead: false,
            },
          ],
        },
      },
    });

    policies.push({ id: policy.id, teamId: team.id });
  }

  const services: Array<{ id: string; name: string; teamId: string; status: ServiceStatus }> = [];
  const demoRegions = ['us-east-1', 'eu-west-1', 'ap-south-1'] as const;
  const slackIntegration = await prisma.slackIntegration.create({
    data: {
      workspaceId: 'T00000001',
      workspaceName: 'OpsKnight Demo',
      botToken: encryptWithKey('xoxb-demo-token', seedKey),
      signingSecret: encryptWithKey('slack-signing-secret', seedKey),
      installedBy: admin.id,
      scopes: ['chat:write', 'channels:read', 'users:read'],
      enabled: true,
    },
  });

  let slackAttached = false;
  for (const team of teams) {
    const policy = policies.find(item => item.teamId === team.id);
    for (let index = 0; index < seedConfig.servicesPerTeam; index++) {
      const template = randomPick(serviceCatalog);
      const name = `${team.name.split(' ')[0]} ${template.name} ${index + 1}`;
      const status = randomPick(serviceStatuses);
      const attachSlack = !slackAttached;
      const service = await prisma.service.create({
        data: {
          name,
          description: `Managed by ${team.name}`,
          status,
          region:
            index === 2
              ? 'us-east-1, eu-west-1'
              : (demoRegions.at(teams.indexOf(team) % demoRegions.length) ?? 'us-east-1'),
          slaTier: template.tier,
          teamId: team.id,
          escalationPolicyId: policy?.id,
          targetAckMinutes: template.tier === 'Gold' ? 10 : 45,
          targetResolveMinutes: template.tier === 'Gold' ? 90 : 240,
          serviceNotificationChannels: ['EMAIL', 'SLACK'],
          serviceNotifyOnTriggered: true,
          serviceNotifyOnAck: true,
          serviceNotifyOnResolved: true,
          serviceNotifyOnSlaBreach: true,
          slackIntegrationId: attachSlack ? slackIntegration.id : null,
          slackChannel: attachSlack ? '#incidents' : null,
          slackWebhookUrl: attachSlack ? 'https://hooks.slack.com/services/T000/B000/XXXX' : null,
          webhookUrl: index === 1 ? 'https://webhook.site/opsknight-demo' : null,
        },
      });

      services.push({ id: service.id, name: service.name, teamId: team.id, status });
      if (attachSlack) slackAttached = true;

      await prisma.integration.create({
        data: {
          name: `${service.name} Events API`,
          type: 'EVENTS_API_V2',
          key: `${service.name.toLowerCase().replace(/\s+/g, '-')}-key`,
          serviceId: service.id,
        },
      });

      await prisma.webhookIntegration.create({
        data: {
          serviceId: service.id,
          name: `${service.name} Teams Webhook`,
          type: 'TEAMS',
          url: 'https://example.com/webhook/teams',
          secret: encryptWithKey(`${service.id}-teams`, seedKey),
          channel: 'incident-room',
          enabled: true,
        },
      });

      await prisma.sLADefinition.create({
        data: {
          name: `${service.name} MTTA`,
          description: `MTTA SLA for ${service.name}`,
          targetAckTime: template.tier === 'Gold' ? 15 : 30,
          targetResolveTime: template.tier === 'Gold' ? 120 : 360,
          serviceId: service.id,
          priority: template.tier === 'Gold' ? 'P1' : 'P2',
          target: 99.5,
          window: '30d',
          metricType: 'MTTA',
        },
      });
    }
  }

  for (const tag of tags) {
    await prisma.tag.create({ data: tag });
  }

  const templates = [
    {
      name: 'Database Incident',
      description: 'Standard database degradation template',
      title: 'Database latency elevated',
      descriptionText: 'Database latency and error rates elevated across read replicas.',
      defaultUrgency: PrismaIncidentUrgency.HIGH,
      defaultPriority: 'P1',
    },
    {
      name: 'API Performance',
      description: 'API performance regression template',
      title: 'API latency regression',
      descriptionText: 'Latency regression detected in API Gateway.',
      defaultUrgency: PrismaIncidentUrgency.MEDIUM,
      defaultPriority: 'P2',
    },
  ] satisfies Array<{
    name: string;
    description: string;
    title: string;
    descriptionText: string;
    defaultUrgency: PrismaIncidentUrgency;
    defaultPriority: string;
  }>;

  for (const template of templates) {
    await prisma.incidentTemplate.create({
      data: {
        name: template.name,
        description: template.description,
        title: template.title,
        descriptionText: template.descriptionText,
        defaultUrgency: template.defaultUrgency,
        defaultPriority: template.defaultPriority,
        defaultServiceId: services[0]?.id ?? null,
        createdById: admin.id,
        isPublic: true,
      },
    });
  }

  const incidents: Array<{
    id: string;
    urgency: IncidentUrgency;
    status: IncidentStatus;
    createdAt: Date;
  }> = [];

  for (let i = 0; i < seedConfig.incidents; i++) {
    const service = services[i % services.length];
    const scenario = randomPick(incidentScenarios);
    const urgency = urgencyLevels[i % urgencyLevels.length];
    const status = incidentStatuses[i % incidentStatuses.length];
    const daysBack = randomInt(seedConfig.incidentHistoryDays);
    const createdAt = minutesFrom(daysAgo(daysBack), randomInt(1440));

    const ackDelay =
      urgency === 'HIGH'
        ? randomInt(15) + 1
        : urgency === 'MEDIUM'
          ? randomInt(45) + 5
          : randomInt(90) + 10;
    const resolveDelay =
      urgency === 'HIGH'
        ? randomInt(180) + 10
        : urgency === 'MEDIUM'
          ? randomInt(360) + 30
          : randomInt(1440) + 60;

    const acknowledgedAt = status === 'OPEN' ? null : clampToNow(minutesFrom(createdAt, ackDelay));
    const resolvedAt =
      status === 'RESOLVED'
        ? clampToNow(minutesFrom(acknowledgedAt ?? createdAt, resolveDelay))
        : null;

    const activeUsers = seededUsers.filter(u => u.status === 'ACTIVE');
    const assignedUser = activeUsers[(i % (activeUsers.length - 1)) + 1] ?? admin;
    const isUserAssigned = i % 3 === 0;

    const incident = await prisma.incident.create({
      data: {
        title: `${service.name}: ${scenario.title}`,
        description: scenario.desc,
        status,
        urgency,
        priority: urgency === 'HIGH' ? 'P1' : urgency === 'MEDIUM' ? 'P2' : 'P3',
        serviceId: service.id,
        teamId: isUserAssigned ? null : service.teamId,
        assigneeId: isUserAssigned ? assignedUser.id : null,
        visibility: i % 7 === 0 ? 'PRIVATE' : 'PUBLIC',
        slaAckTargetMs:
          urgency === 'HIGH' ? 5 * 60_000 : urgency === 'MEDIUM' ? 15 * 60_000 : 30 * 60_000,
        slaResolveTargetMs:
          urgency === 'HIGH' ? 60 * 60_000 : urgency === 'MEDIUM' ? 240 * 60_000 : 480 * 60_000,
        slaTargetSource: 'service',
        slaTargetCapturedAt: createdAt,
        dedupKey: `seed-${service.id}-${i}`,
        createdAt,
        updatedAt: resolvedAt ?? acknowledgedAt ?? createdAt,
        acknowledgedAt,
        resolvedAt,
        snoozedUntil: status === 'SNOOZED' ? minutesFrom(createdAt, 90) : null,
        snoozeReason: status === 'SNOOZED' ? 'Maintenance window' : null,
        currentEscalationStep: status === 'OPEN' ? 1 : null,
        escalationStatus: status === 'OPEN' ? 'ESCALATING' : null,
        nextEscalationAt: status === 'OPEN' ? minutesFrom(createdAt, 20) : null,
      },
    });

    incidents.push({ id: incident.id, urgency, status, createdAt });

    await prisma.incidentEvent.create({
      data: { incidentId: incident.id, message: 'Incident triggered', createdAt },
    });

    if (acknowledgedAt) {
      await prisma.incidentEvent.create({
        data: {
          incidentId: incident.id,
          message: 'Incident acknowledged',
          createdAt: acknowledgedAt,
        },
      });
    }

    if (resolvedAt) {
      await prisma.incidentEvent.create({
        data: { incidentId: incident.id, message: 'Incident resolved', createdAt: resolvedAt },
      });
    }

    await prisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        userId: activeUsers[2]?.id ?? admin.id,
        content: 'Investigating root cause and mitigations.',
        createdAt: minutesFrom(createdAt, 15),
      },
    });

    await prisma.incidentWatcher.create({
      data: {
        incidentId: incident.id,
        userId: activeUsers[3]?.id ?? admin.id,
        role: 'STAKEHOLDER',
      },
    });

    const tagList = await prisma.tag.findMany({ take: 2, skip: i % 3 });
    for (const tag of tagList) {
      await prisma.incidentTag.create({
        data: { incidentId: incident.id, tagId: tag.id },
      });
    }

    await prisma.alert.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        status: resolvedAt ? 'RESOLVED' : 'TRIGGERED',
        dedupKey: `alert-${incident.id}`,
        payload: {
          source: 'cloudwatch',
          metric: 'latency',
          thresholdMs: 500,
          observedMs: 820,
        },
        createdAt,
      },
    });

    await prisma.notification.create({
      data: {
        incidentId: incident.id,
        userId: activeUsers[4]?.id ?? admin.id,
        channel: randomPick(notificationChannels),
        status: resolvedAt ? 'DELIVERED' : 'SENT',
        message: `Incident update for ${service.name}`,
        sentAt: minutesFrom(createdAt, 5),
        deliveredAt: resolvedAt ? minutesFrom(createdAt, 8) : null,
        attempts: 1,
      },
    });

    if (resolvedAt && urgency !== 'LOW' && i % 3 === 0) {
      await prisma.postmortem.create({
        data: {
          incidentId: incident.id,
          title: `Postmortem: ${scenario.title}`,
          summary: 'Summary of impact and recovery steps.',
          rootCause: 'Capacity planning shortfall',
          resolution: 'Scaled primary database cluster',
          actionItems: [
            { owner: 'Platform', action: 'Add capacity alerts', dueDate: '2025-03-01' },
            { owner: 'SRE', action: 'Update runbook', dueDate: '2025-03-10' },
          ],
          status: 'PUBLISHED',
          isPublic: true,
          publishedAt: minutesFrom(resolvedAt, 10),
          createdById: admin.id,
        },
      });
    }
  }

  const customFields = await prisma.customField.createMany({
    data: [
      {
        name: 'Customer Tier',
        key: 'customer_tier',
        type: 'SELECT',
        required: false,
        defaultValue: 'enterprise',
        options: ['enterprise', 'mid-market', 'startup'],
        order: 1,
        showInList: true,
      },
      {
        name: 'Region',
        key: 'region',
        type: 'TEXT',
        required: false,
        defaultValue: 'us-east-1',
        order: 2,
        showInList: true,
      },
    ],
  });

  if (customFields.count > 0) {
    const fields = await prisma.customField.findMany();
    for (const incident of incidents.slice(0, 6)) {
      for (const field of fields) {
        await prisma.customFieldValue.create({
          data: {
            incidentId: incident.id,
            customFieldId: field.id,
            value: field.key === 'customer_tier' ? 'enterprise' : 'us-east-1',
          },
        });
      }
    }
  }

  await prisma.inAppNotification.create({
    data: {
      userId: admin.id,
      type: 'INCIDENT',
      title: 'Incident escalated',
      message: 'Payment Processor latency has escalated to high urgency.',
      entityType: 'incident',
      entityId: incidents[0]?.id,
      readAt: null,
    },
  });

  await prisma.userDevice.create({
    data: {
      userId: admin.id,
      deviceId: 'device-admin-1',
      token: hashSecret('fcm-token-admin'),
      platform: 'web',
      userAgent: 'Seed Script',
    },
  });

  const apiKeySeed = `admin-${Date.now()}`;
  await prisma.apiKey.create({
    data: {
      name: 'Admin CLI Key',
      prefix: apiKeySeed.slice(0, 8),
      tokenHash: hashSecret(apiKeySeed),
      scopes: ['incidents:read', 'incidents:write', 'services:read'],
      userId: admin.id,
    },
  });

  await prisma.userToken.create({
    data: {
      type: 'INVITE',
      identifier: seededUsers[2]?.email ?? 'invite@example.com',
      tokenHash: hashSecret('invite-token'),
      expiresAt: minutesFrom(new Date(), 60 * 24),
      metadata: { source: 'seed' },
    },
  });

  const statusPage = await seedPublicStatusSurface({
    adminId: admin.id,
    teams,
    policies,
    services,
  });

  for (const service of services.slice(0, 4)) {
    await prisma.metricRollup.create({
      data: {
        name: 'http.request.duration',
        bucket: daysAgo(1),
        serviceId: service.id,
        count: 1200,
        sum: 48000,
        min: 80,
        max: 900,
        tags: { status: '200', method: 'GET' },
      },
    });
  }

  for (const team of teams.slice(0, 3)) {
    await prisma.incidentMetricRollup.create({
      data: {
        date: daysAgo(1),
        granularity: 'daily',
        teamId: team.id,
        totalIncidents: 5,
        openIncidents: 1,
        acknowledgedIncidents: 2,
        resolvedIncidents: 2,
        highUrgencyIncidents: 1,
        mediumUrgencyIncidents: 2,
        lowUrgencyIncidents: 2,
        mttaSum: BigInt(360000),
        mttaCount: 5,
        mttrSum: BigInt(540000),
        mttrCount: 5,
        ackSlaMet: 4,
        ackSlaBreached: 1,
        resolveSlaMet: 4,
        resolveSlaBreached: 1,
        escalationCount: 1,
        reopenCount: 0,
        autoResolveCount: 0,
        alertCount: 5,
        afterHoursCount: 1,
      },
    });
  }

  for (let day = 0; day < seedConfig.slaSnapshotDays; day++) {
    const snapshotDate = daysAgo(day);
    const definition = await prisma.sLADefinition.findFirst();
    if (definition) {
      await prisma.sLASnapshot.create({
        data: {
          slaDefinitionId: definition.id,
          date: snapshotDate,
          totalIncidents: 12,
          metAckTime: 10,
          metResolveTime: 9,
          complianceScore: 92.5,
        },
      });
    }
  }

  await prisma.sLAPerformanceLog.create({
    data: {
      timestamp: new Date(),
      serviceId: services[0]?.id ?? null,
      teamId: teams[0]?.id ?? null,
      windowDays: 30,
      durationMs: 1200,
      incidentCount: 42,
    },
  });

  await prisma.backgroundJob.create({
    data: {
      type: 'ESCALATION',
      status: 'PENDING',
      scheduledAt: minutesFrom(new Date(), 30),
      payload: {
        incidentId: incidents[0]?.id,
        step: 1,
      },
    },
  });

  await prisma.logEntry.create({
    data: {
      level: 'info',
      message: 'Seeded log entry for observability demo',
      timestamp: new Date(),
      serviceId: services[0]?.id ?? null,
      context: { requestId: 'seed-req-1', region: 'us-east-1' },
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        action: 'INCIDENT_CREATED',
        entityType: 'SERVICE',
        entityId: services[0]?.id,
        actorId: admin.id,
        details: { source: 'seed' },
      },
      {
        action: 'SERVICE_UPDATED',
        entityType: 'SERVICE',
        entityId: services[0]?.id,
        actorId: admin.id,
        details: { status: services[0]?.status },
      },
      {
        action: 'ESCALATION_POLICY_CREATED',
        entityType: 'ESCALATION_POLICY',
        entityId: policies[0]?.id,
        actorId: admin.id,
        details: { name: policies[0]?.id },
      },
    ],
  });

  process.stdout.write(
    'Seed complete. Admin login: admin@example.com / Password123!\n' +
      'Status pages: /status (mixed) · /status/healthy (all green) · /status/degraded (medium-urgency / partial outage)\n'
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async error => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`
    );
    await prisma.$disconnect();
    process.exit(1);
  });
