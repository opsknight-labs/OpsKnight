/**
 * Supplementary, idempotent dashboard fixtures for LOCAL development only.
 *
 *   npm run seed:dashboard -- --scenario=busy
 *
 * Scenarios (active incidents owned by "Dashboard Alpha"):
 *   empty   0   (the dedicated empty-team user always sees an empty feed)
 *   normal  5
 *   busy    30
 *   stress  --count=100..250 (default 150)
 *
 * Every run also (re)creates a fixed "Dashboard Bravo" set (P1 + resolved incidents) that
 * alpha users must never see, plus fixture users for authorization/filter certification.
 * Only incidents whose dedupKey starts with "dashboard-live:" are ever removed.
 *
 * These are direct Prisma writes. They still bump the realtime change feed (statement trigger),
 * but realtime certification must create/update incidents through the application workflows.
 */
import { PrismaClient, type IncidentStatus, type IncidentUrgency } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const DASHBOARD_FIXTURE_PREFIX = 'dashboard-live:';
export const DASHBOARD_FIXTURE_USERS = {
  admin: 'dashboard-admin@example.local',
  alpha: 'dashboard-alpha@example.local',
  alphaPeer: 'dashboard-alpha-peer@example.local',
  bravo: 'dashboard-bravo@example.local',
  empty: 'dashboard-empty@example.local',
} as const;

const SCENARIO_SIZES = { empty: 0, normal: 5, busy: 30 } as const;
export type DashboardScenario = keyof typeof SCENARIO_SIZES | 'stress';

const TITLES = [
  'API Gateway unavailable',
  'Database latency elevated',
  'Payment processor errors',
  'Checkout p99 above SLO',
  'Queue backlog growing',
  'TLS certificate expiring',
  'Cache hit ratio collapsed',
  'Search indexer lagging',
  'Webhook delivery failures',
  'Disk usage above 90%',
];

export function assertLocalDashboardTarget(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required.');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(`Refusing to seed non-loopback database host "${url.hostname}".`);
  }
  const database = url.pathname.replace(/^\//, '');
  const allowed = env.DASHBOARD_SEED_ALLOW_DB ?? 'opsknight_dashboard';
  if (database !== allowed) {
    throw new Error(
      `Refusing to seed database "${database}". Set DASHBOARD_SEED_ALLOW_DB=${database} to opt in.`
    );
  }
}

export function parseDashboardSeedArgs(argv: string[]): {
  scenario: DashboardScenario;
  count: number;
} {
  const get = (name: string) =>
    argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const scenario = (get('scenario') ?? 'normal') as DashboardScenario;
  if (!['empty', 'normal', 'busy', 'stress'].includes(scenario)) {
    throw new Error(`Unknown scenario "${scenario}". Use empty|normal|busy|stress.`);
  }
  if (scenario !== 'stress') return { scenario, count: SCENARIO_SIZES[scenario] };
  const count = Number(get('count') ?? 150);
  if (!Number.isInteger(count) || count < 100 || count > 250) {
    throw new Error('--count must be an integer between 100 and 250 for the stress scenario.');
  }
  return { scenario, count };
}

export type FixtureIncident = {
  key: string;
  title: string;
  status: IncidentStatus;
  urgency: IncidentUrgency;
  priority: string;
  createdAt: Date;
  serviceId: string;
  teamId: string;
  assigneeId: string | null;
};

export function buildAlphaIncidents(
  count: number,
  now: number,
  ids: {
    apiServiceId: string;
    workerServiceId: string;
    teamId: string;
    alphaId: string;
    peerId: string;
  }
): FixtureIncident[] {
  const incidents: FixtureIncident[] = [];
  for (let index = 0; index < count; index += 1) {
    const priority = ['P1', 'P2', 'P3'][index % 3];
    // Newest first: index 0 was created seconds ago, the tail spans ~10 days.
    const ageMs = index === 0 ? 20_000 : Math.round((index / count) * 10 * 86_400_000);
    incidents.push({
      key: `${DASHBOARD_FIXTURE_PREFIX}alpha:${index}`,
      title: `${TITLES[index % TITLES.length]} #${index + 1}`,
      status: index % 4 === 1 ? 'ACKNOWLEDGED' : 'OPEN',
      urgency: priority === 'P1' ? 'HIGH' : priority === 'P2' ? 'MEDIUM' : 'LOW',
      priority,
      createdAt: new Date(now - ageMs),
      serviceId: index % 2 === 0 ? ids.apiServiceId : ids.workerServiceId,
      teamId: ids.teamId,
      assigneeId: index % 3 === 0 ? null : index % 3 === 1 ? ids.alphaId : ids.peerId,
    });
  }
  return incidents;
}

async function main(): Promise<void> {
  assertLocalDashboardTarget();
  const { scenario, count } = parseDashboardSeedArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const password = process.env.DASHBOARD_FIXTURE_PASSWORD ?? 'Password123!';
    const passwordHash = await bcrypt.hash(password, 10);

    const upsertUser = (email: string, name: string, role: 'USER' | 'ADMIN' = 'USER') =>
      prisma.user.upsert({
        where: { email },
        update: { passwordHash, status: 'ACTIVE', role },
        create: { email, name, passwordHash, status: 'ACTIVE', role, timeZone: 'UTC' },
      });
    const upsertTeam = (name: string) =>
      prisma.team.upsert({
        where: { name },
        update: {},
        create: { name, description: 'Local dashboard fixture team' },
      });

    await upsertUser(DASHBOARD_FIXTURE_USERS.admin, 'Avery Admin', 'ADMIN');
    const alpha = await upsertUser(DASHBOARD_FIXTURE_USERS.alpha, 'Dana Alpha');
    const alphaPeer = await upsertUser(DASHBOARD_FIXTURE_USERS.alphaPeer, 'Parker Alpha');
    const bravo = await upsertUser(DASHBOARD_FIXTURE_USERS.bravo, 'Blair Bravo');
    const empty = await upsertUser(DASHBOARD_FIXTURE_USERS.empty, 'Emery Empty');
    const alphaTeam = await upsertTeam('Dashboard Alpha');
    const bravoTeam = await upsertTeam('Dashboard Bravo');
    const emptyTeam = await upsertTeam('Dashboard Empty');
    for (const [teamId, userId] of [
      [alphaTeam.id, alpha.id],
      [alphaTeam.id, alphaPeer.id],
      [bravoTeam.id, bravo.id],
      [emptyTeam.id, empty.id],
    ] as const) {
      await prisma.teamMember.upsert({
        where: { userId_teamId: { userId, teamId } },
        update: {},
        create: { userId, teamId, role: 'MEMBER' },
      });
    }

    const upsertService = (name: string, teamId: string) =>
      prisma.service.upsert({
        where: { name },
        update: { teamId },
        create: { name, teamId, description: 'Local dashboard fixture service' },
      });
    const alphaApi = await upsertService('Dashboard Alpha API', alphaTeam.id);
    const alphaWorker = await upsertService('Dashboard Alpha Worker', alphaTeam.id);
    const bravoGateway = await upsertService('Dashboard Bravo Gateway', bravoTeam.id);

    // Incidents opened by certification runs on fixture services are fixtures too.
    const removed = await prisma.incident.deleteMany({
      where: {
        OR: [
          { dedupKey: { startsWith: DASHBOARD_FIXTURE_PREFIX } },
          { serviceId: { in: [alphaApi.id, alphaWorker.id, bravoGateway.id] } },
        ],
      },
    });

    const now = Date.now();
    const alphaIncidents = buildAlphaIncidents(count, now, {
      apiServiceId: alphaApi.id,
      workerServiceId: alphaWorker.id,
      teamId: alphaTeam.id,
      alphaId: alpha.id,
      peerId: alphaPeer.id,
    });
    const fixed: FixtureIncident[] = [
      ...[0, 1, 2].map(index => ({
        key: `${DASHBOARD_FIXTURE_PREFIX}alpha-resolved:${index}`,
        title: `Resolved: ${TITLES[(index + 3) % TITLES.length]}`,
        status: 'RESOLVED' as const,
        urgency: 'HIGH' as const,
        priority: 'P2',
        createdAt: new Date(now - (index + 1) * 3_600_000),
        serviceId: alphaApi.id,
        teamId: alphaTeam.id,
        assigneeId: alpha.id,
      })),
      ...[0, 1, 2, 3].map(index => ({
        key: `${DASHBOARD_FIXTURE_PREFIX}bravo:${index}`,
        title: `Bravo restricted: ${TITLES[(index + 5) % TITLES.length]}`,
        status: index === 3 ? ('RESOLVED' as const) : ('OPEN' as const),
        urgency: index < 2 ? ('HIGH' as const) : ('MEDIUM' as const),
        priority: index < 2 ? 'P1' : 'P2',
        createdAt: new Date(now - (index + 1) * 60_000),
        serviceId: bravoGateway.id,
        teamId: bravoTeam.id,
        assigneeId: index % 2 === 0 ? bravo.id : null,
      })),
    ];

    const rows = [...alphaIncidents, ...fixed];
    const BATCH = 100;
    for (let start = 0; start < rows.length; start += BATCH) {
      await prisma.incident.createMany({
        data: rows.slice(start, start + BATCH).map(row => ({
          title: row.title,
          description: 'Local dashboard fixture incident.',
          status: row.status,
          urgency: row.urgency,
          priority: row.priority,
          dedupKey: row.key,
          serviceId: row.serviceId,
          // Incident_assignment_exclusive: user- and team-assignment are mutually exclusive.
          // Team ownership of user-assigned incidents still flows through the service.
          teamId: row.assigneeId ? null : row.teamId,
          assigneeId: row.assigneeId,
          createdAt: row.createdAt,
          acknowledgedAt:
            row.status === 'ACKNOWLEDGED' || row.status === 'RESOLVED'
              ? new Date(row.createdAt.getTime() + 60_000)
              : null,
          resolvedAt:
            row.status === 'RESOLVED' ? new Date(row.createdAt.getTime() + 600_000) : null,
        })),
      });
    }

    console.log(
      JSON.stringify(
        {
          scenario,
          alphaActive: alphaIncidents.length,
          fixedIncidents: fixed.length,
          removedPreviousFixtures: removed.count,
          users: DASHBOARD_FIXTURE_USERS,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
