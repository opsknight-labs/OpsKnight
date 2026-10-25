/**
 * Reproducible concurrent-console load test for the live dashboard. LOCAL development only.
 *
 *   set -a && source .env.dashboard.local && set +a
 *   npm run seed:dashboard -- --scenario=busy
 *   # serve a production build (next start) on :3200, then:
 *   npm run load:dashboard -- --base=http://localhost:3200 --viewers=250 --rate=10 --duration=60
 *
 * Each virtual viewer behaves like a real console: it holds one SSE connection
 * (/api/realtime/stream, `mode=signal` by default), and on every `changed` signal re-reads
 * /api/dashboard/live with the same rate limiting, jitter and If-None-Match revalidation as the
 * browser provider. New incidents are inserted straight into the isolated database (the change
 * clock trigger publishes them, exactly like application writes); end-to-end latency is the time
 * from insert completion until a viewer's snapshot contains the incident.
 *
 * Viewers share the session of one user per authorization scope (admin = global, alpha = team
 * scoped), so this does NOT cover hundreds of distinct individual scopes. Results are a local
 * benchmark, not a capacity certification.
 */
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { assertLocalDashboardTarget } from './seed-dashboard-live';

type Options = {
  base: string;
  viewers: number;
  rate: number;
  duration: number;
  mode: 'signal' | 'full';
  adminShare: number;
  slow: number;
  serverPid: number | null;
  dbContainer: string | null;
  out: string | null;
};

function parseArgs(argv: string[]): Options {
  const read = (name: string, fallback?: string) => {
    const hit = argv.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const number = (name: string, fallback: number) => {
    const value = Number(read(name, String(fallback)));
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a number`);
    return value;
  };
  const mode = read('mode', 'signal');
  if (mode !== 'signal' && mode !== 'full') throw new Error('--mode must be signal or full');
  return {
    base: read('base', 'http://localhost:3200')!,
    viewers: number('viewers', 100),
    rate: number('rate', 10),
    duration: number('duration', 60),
    mode,
    adminShare: number('admin-share', 0.5),
    slow: number('slow', 0),
    serverPid: read('server-pid') ? Number(read('server-pid')) : null,
    dbContainer: read('db-container', 'opsknight-dashboard-pg') ?? null,
    out: read('out') ?? null,
  };
}

const USERS = {
  admin: { email: 'admin@example.com', password: 'Password123!' },
  alpha: { email: 'dashboard-alpha@example.local', password: 'Password123!' },
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10;
}

const summarize = (values: number[]) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  p99: percentile(values, 0.99),
  max: values.length ? Math.round(Math.max(...values) * 10) / 10 : null,
});

async function login(base: string, user: { email: string; password: string }) {
  const jar = new Map<string, string>();
  const remember = (response: Response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const csrfResponse = await fetch(`${base}/api/auth/csrf`);
  remember(csrfResponse);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const response = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, ...user, callbackUrl: `${base}/`, json: 'true' }),
  });
  remember(response);
  const probe = await fetch(`${base}/api/dashboard/live`, { headers: { cookie: cookie() } });
  if (!probe.ok) throw new Error(`login failed for ${user.email} (${probe.status})`);
  return cookie();
}

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

type Shared = {
  opts: Options;
  pending: Map<string, number>;
  visible: number[];
  reconcileMs: number[];
  reads: { full: number; notModified: number; failed: number };
  connections: { opened: number; failed: number; reconnects: number; closedByServer: number };
  heartbeats: number;
  signals: number;
  stopped: boolean;
};

class Viewer {
  private generation: string | null = null;
  private etag: string | null = null;
  private lastStart = 0;
  private lastDuration = 0;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private dirty = false;
  private request: http.ClientRequest | null = null;
  private seen = new Set<string>();
  private opened = false;

  constructor(
    private readonly shared: Shared,
    private readonly cookie: string,
    private readonly slow: boolean
  ) {}

  connect() {
    const { opts } = this.shared;
    const url = new URL(
      `${opts.base}/api/realtime/stream${opts.mode === 'signal' ? '?mode=signal' : ''}`
    );
    const request = http.get(
      url,
      { agent, headers: { cookie: this.cookie, accept: 'text/event-stream' } },
      response => {
        if (response.statusCode !== 200) {
          this.shared.connections.failed += 1;
          response.resume();
          return this.retry();
        }
        if (!this.opened) this.shared.connections.opened += 1;
        else this.shared.connections.reconnects += 1;
        this.opened = true;
        if (this.slow) {
          // A consumer that never reads: the server must close it rather than buffer forever.
          response.pause();
        }
        let buffer = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith('data: ')) this.onMessage(frame.slice(6));
          }
        });
        response.on('close', () => {
          if (this.shared.stopped) return;
          this.shared.connections.closedByServer += 1;
          this.retry();
        });
      }
    );
    request.on('error', () => {
      if (this.shared.stopped) return;
      this.shared.connections.failed += 1;
      this.retry();
    });
    this.request = request;
  }

  private retry() {
    if (this.shared.stopped) return;
    setTimeout(() => this.connect(), 1_000 + Math.random() * 2_000);
  }

  private onMessage(raw: string) {
    let event: { type?: string; generation?: string };
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.type === 'heartbeat') this.shared.heartbeats += 1;
    if (event.type === 'connected') this.schedule();
    if (event.type === 'changed') {
      this.shared.signals += 1;
      this.generation = event.generation ?? this.generation;
      this.schedule();
    }
  }

  // Mirrors LiveDashboardProvider: leading edge when idle, one read per gap during bursts.
  private schedule() {
    if (this.timer || this.shared.stopped) return;
    const gap = Math.min(5_000, Math.max(1_000, this.lastDuration * 3));
    const wait = Math.max(75, this.lastStart + gap - Date.now()) + Math.random() * 150;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.read();
    }, wait);
  }

  private async read() {
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    this.inFlight = true;
    this.lastStart = Date.now();
    const startedAt = performance.now();
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (this.generation) params.set('after', this.generation);
      const headers: Record<string, string> = { cookie: this.cookie };
      if (this.etag) headers['if-none-match'] = this.etag;
      const response = await fetch(`${this.shared.opts.base}/api/dashboard/live?${params}`, {
        headers,
      });
      const elapsed = performance.now() - startedAt;
      this.lastDuration = elapsed;
      this.shared.reconcileMs.push(elapsed);
      if (response.status === 304) {
        this.shared.reads.notModified += 1;
        return;
      }
      if (!response.ok) {
        this.shared.reads.failed += 1;
        await response.arrayBuffer();
        return;
      }
      this.shared.reads.full += 1;
      this.etag = response.headers.get('etag');
      const body = (await response.json()) as { data?: { incidents?: Array<{ id: string }> } };
      const now = Date.now();
      for (const incident of body.data?.incidents ?? []) {
        if (this.seen.has(incident.id)) continue;
        this.seen.add(incident.id);
        const createdAt = this.shared.pending.get(incident.id);
        if (createdAt !== undefined) this.shared.visible.push(now - createdAt);
      }
    } catch {
      this.shared.reads.failed += 1;
    } finally {
      this.inFlight = false;
      if (this.dirty) {
        this.dirty = false;
        this.schedule();
      }
    }
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.request?.destroy();
  }
}

function sampleRss(pid: number | null): number | null {
  if (!pid) return null;
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) / 1024);
  } catch {
    return null;
  }
}

function dbQuery(container: string | null, sql: string): string | null {
  if (!container) return null;
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        container,
        'psql',
        '-U',
        'opsknight_dashboard',
        '-d',
        'opsknight_dashboard',
        '-tAc',
        sql,
      ],
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return null;
  }
}

async function main() {
  assertLocalDashboardTarget();
  const opts = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const runId = Date.now().toString(36);
  const service = await prisma.service.findUniqueOrThrow({
    where: { name: 'Dashboard Alpha API' },
    select: { id: true },
  });

  const cookies = {
    admin: await login(opts.base, USERS.admin),
    alpha: await login(opts.base, USERS.alpha),
  };

  const shared: Shared = {
    opts,
    pending: new Map(),
    visible: [],
    reconcileMs: [],
    reads: { full: 0, notModified: 0, failed: 0 },
    connections: { opened: 0, failed: 0, reconnects: 0, closedByServer: 0 },
    heartbeats: 0,
    signals: 0,
    stopped: false,
  };

  const viewers: Viewer[] = [];
  const adminCount = Math.round(opts.viewers * opts.adminShare);
  for (let index = 0; index < opts.viewers; index += 1) {
    const viewer = new Viewer(
      shared,
      index < adminCount ? cookies.admin : cookies.alpha,
      index >= opts.viewers - opts.slow
    );
    viewers.push(viewer);
    viewer.connect();
    // Ramp: avoid a synthetic connect storm that real browsers would not produce.
    if (index % 25 === 24) await new Promise(resolve => setTimeout(resolve, 200));
  }
  await new Promise(resolve => setTimeout(resolve, 3_000));

  const rssSamples: number[] = [];
  const dbConnections: number[] = [];
  const sampler = setInterval(() => {
    const rss = sampleRss(opts.serverPid);
    if (rss !== null) rssSamples.push(rss);
    const connections = dbQuery(
      opts.dbContainer,
      "select count(*) from pg_stat_activity where datname='opsknight_dashboard'"
    );
    if (connections !== null) dbConnections.push(Number(connections));
  }, 5_000);

  const dbBefore = dbQuery(
    opts.dbContainer,
    "select xact_commit+xact_rollback||','||tup_returned from pg_stat_database where datname='opsknight_dashboard'"
  );

  const createdMs: number[] = [];
  let created = 0;
  const startedAt = Date.now();
  const tickMs = 100;
  let carry = 0;
  while (Date.now() - startedAt < opts.duration * 1_000) {
    const tickStart = Date.now();
    carry += (opts.rate * tickMs) / 1_000;
    const batch = Math.floor(carry);
    carry -= batch;
    for (let i = 0; i < batch; i += 1) {
      const sequence = created++;
      const insertStart = performance.now();
      const incident = await prisma.incident.create({
        data: {
          title: `Load ${runId} #${sequence}`,
          description: 'Local dashboard load fixture.',
          status: 'OPEN',
          urgency: sequence % 5 === 0 ? 'HIGH' : 'LOW',
          priority: sequence % 5 === 0 ? 'P1' : 'P3',
          dedupKey: `dashboard-live:load-${runId}-${sequence}`,
          serviceId: service.id,
        },
        select: { id: true },
      });
      createdMs.push(performance.now() - insertStart);
      shared.pending.set(incident.id, Date.now());
    }
    const wait = tickMs - (Date.now() - tickStart);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  }
  // Let the last incidents propagate before measuring.
  await new Promise(resolve => setTimeout(resolve, 6_000));
  clearInterval(sampler);
  const dbAfter = dbQuery(
    opts.dbContainer,
    "select xact_commit+xact_rollback||','||tup_returned from pg_stat_database where datname='opsknight_dashboard'"
  );

  shared.stopped = true;
  for (const viewer of viewers) viewer.close();
  await prisma.incident.deleteMany({
    where: { dedupKey: { startsWith: `dashboard-live:load-${runId}` } },
  });
  await prisma.$disconnect();

  const [xBefore, tBefore] = (dbBefore ?? '0,0').split(',').map(Number);
  const [xAfter, tAfter] = (dbAfter ?? '0,0').split(',').map(Number);
  const elapsedSeconds = (Date.now() - startedAt) / 1_000;
  const expectedSamples = created * viewers.filter(v => v !== undefined).length;
  const result = {
    config: { ...opts, runId, nodeVersion: process.version },
    ingest: {
      created,
      achievedPerSecond: Math.round((created / opts.duration) * 10) / 10,
      insertMs: summarize(createdMs),
    },
    connections: shared.connections,
    signalsReceived: shared.signals,
    heartbeatsReceived: shared.heartbeats,
    reads: {
      ...shared.reads,
      perSecond:
        Math.round(((shared.reads.full + shared.reads.notModified) / elapsedSeconds) * 10) / 10,
      latencyMs: summarize(shared.reconcileMs),
    },
    endToEndVisibleMs: {
      ...summarize(shared.visible),
      delivered: shared.visible.length,
      expected: expectedSamples,
    },
    server: {
      rssMb: rssSamples.length
        ? { first: rssSamples[0], max: Math.max(...rssSamples), last: rssSamples.at(-1) }
        : null,
    },
    database: {
      connectionsMax: dbConnections.length ? Math.max(...dbConnections) : null,
      transactionsPerSecond: Math.round(((xAfter - xBefore) / elapsedSeconds) * 10) / 10,
      tuplesReturnedPerSecond: Math.round((tAfter - tBefore) / elapsedSeconds),
    },
  };
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (opts.out) writeFileSync(opts.out, `${json}\n`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
