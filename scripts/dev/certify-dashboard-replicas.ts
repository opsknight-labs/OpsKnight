/**
 * Two-replica functional check for the live dashboard. LOCAL development only; small fixture data,
 * no load. It answers: does the dashboard stay correct when requests and streams land on different
 * application processes, and when one of them is stopped?
 *
 *   set -a && source .env.dashboard.local && set +a
 *   npm run seed:dashboard -- --scenario=normal
 *   # two production replicas on the same database and secrets, e.g. ports 3201 and 3202
 *   npm run certify:dashboard:replicas -- --a=http://localhost:3201 --b=http://localhost:3202 --pid-a=<PID of replica A>
 *
 * Checks (each prints PASS/FAIL, the script exits non-zero on any FAIL):
 *  1. a session issued by replica A is accepted by replica B
 *  2. both replicas produce the same validator for the same viewer and unchanged data, and a
 *     conditional request validated by one replica is answered 304 by the other
 *  3. an incident created through replica B reaches a stream held on replica A, and both replicas
 *     return it from the authorized snapshot
 *  4. SIGTERM on replica A releases its stream within the drain window, new streams are refused
 *     (503) while it drains, and the surviving replica serves canonical state without a restart
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertLocalDashboardTarget } from './seed-dashboard-live';

type Args = { a: string; b: string; pidA: number | null };

function parseArgs(argv: string[]): Args {
  const read = (name: string) =>
    argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const a = read('a');
  const b = read('b');
  if (!a || !b) throw new Error('--a=<replica A url> and --b=<replica B url> are required');
  const pid = read('pid-a');
  return { a, b, pidA: pid ? Number(pid) : null };
}

const ADMIN = { email: 'admin@example.com', password: 'Password123!' };
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function login(base: string, user: { email: string; password: string }): Promise<string> {
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
  return cookie();
}

type Stream = {
  events: Array<{ type?: string; generation?: string }>;
  closed: boolean;
  status: number;
  close: () => void;
};

function openStream(base: string, cookie: string): Promise<Stream> {
  return new Promise(resolve => {
    const stream: Stream = { events: [], closed: false, status: 0, close: () => undefined };
    const request = http.get(
      new URL(`${base}/api/realtime/stream?mode=signal`),
      { headers: { cookie, accept: 'text/event-stream' } },
      response => {
        stream.status = response.statusCode ?? 0;
        stream.close = () => request.destroy();
        let buffer = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          buffer += chunk;
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith('data: ')) {
              try {
                stream.events.push(JSON.parse(frame.slice(6)));
              } catch {
                // ignore malformed frame
              }
            }
          }
        });
        response.on('close', () => {
          stream.closed = true;
        });
        if (response.statusCode !== 200) {
          response.resume();
          stream.closed = true;
        }
        resolve(stream);
      }
    );
    request.on('error', () => {
      stream.closed = true;
      resolve(stream);
    });
  });
}

async function until(predicate: () => boolean | Promise<boolean>, timeoutMs: number, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function snapshot(
  base: string,
  cookie: string,
  headers: Record<string, string> = {},
  after?: string
) {
  const query = new URLSearchParams({ limit: '100' });
  if (after) query.set('after', after);
  const response = await fetch(`${base}/api/dashboard/live?${query}`, {
    headers: { cookie, ...headers },
  });
  const body =
    response.status === 200
      ? ((await response.json()) as {
          data: { incidents: Array<{ id: string; title: string }>; generation: string | null };
        })
      : null;
  return { status: response.status, etag: response.headers.get('etag'), body };
}

async function main() {
  assertLocalDashboardTarget();
  const { a, b, pidA } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const runTag = randomUUID().slice(0, 8);
  const title = `Replica check ${runTag}`;
  try {
    const cookie = await login(a, ADMIN);

    // 1. Session portability.
    const onB = await snapshot(b, cookie);
    check(
      'session issued by replica A is accepted by replica B',
      onB.status === 200,
      `status ${onB.status}`
    );

    // 2. Same validator across replicas, cross-replica 304.
    let sameEtag = false;
    let crossNotModified = false;
    for (let attempt = 0; attempt < 4 && !(sameEtag && crossNotModified); attempt += 1) {
      const first = await snapshot(a, cookie);
      const second = await snapshot(b, cookie);
      sameEtag = Boolean(first.etag) && first.etag === second.etag;
      if (sameEtag) {
        const conditional = await snapshot(b, cookie, { 'if-none-match': first.etag! });
        crossNotModified = conditional.status === 304;
      } else {
        await sleep(1_200);
      }
    }
    check('both replicas produce the same validator for unchanged data', sameEtag);
    check('a validator from replica A is honored (304) by replica B', crossNotModified);

    // 3. Change made through B reaches a stream held on A.
    const streamA = await openStream(a, cookie);
    check(
      'replica A accepts a signal-only stream',
      streamA.status === 200,
      `status ${streamA.status}`
    );
    await until(() => streamA.events.some(event => event.type === 'connected'), 5_000);
    const serviceRow = await prisma.service.findFirstOrThrow({ select: { id: true } });
    const origin = new URL(b).origin;
    const created = await fetch(`${b}/api/incidents/create`, {
      method: 'POST',
      headers: {
        cookie,
        Origin: origin,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ title, serviceId: serviceRow.id, urgency: 'HIGH', priority: 'P1' }),
    });
    check('incident created through replica B', created.ok, `status ${created.status}`);
    const signalled = await until(
      () => streamA.events.some(event => event.type === 'changed' && Boolean(event.generation)),
      6_000
    );
    check('the change reaches the stream held on replica A', signalled);
    const latestGeneration = streamA.events
      .filter(event => event.type === 'changed')
      .at(-1)?.generation;
    for (const [name, base] of [
      ['A', a],
      ['B', b],
    ] as const) {
      const visible = await until(
        async () => {
          const read = await snapshot(base, cookie, {}, latestGeneration);
          return Boolean(read.body?.data.incidents.some(incident => incident.title === title));
        },
        6_000,
        300
      );
      check(`replica ${name} returns the new incident from the authorized snapshot`, visible);
    }

    // 4. Replica A is stopped: its stream is released, new ones are refused, B keeps serving.
    if (pidA) {
      process.kill(pidA, 'SIGTERM');
      const released = await until(() => streamA.closed, 8_000);
      check('SIGTERM on replica A releases its open stream within the drain window', released);
      const refused = await openStream(a, cookie);
      check(
        'a draining replica refuses new streams with 503 (or is already gone)',
        refused.status === 503 || refused.status === 0,
        `status ${refused.status}`
      );
      refused.close();
    } else {
      console.log('SKIP  SIGTERM drain check (pass --pid-a to enable)');
      streamA.close();
    }
    const streamB = await openStream(b, cookie);
    check(
      'replica B accepts the reconnecting stream',
      streamB.status === 200,
      `status ${streamB.status}`
    );
    const recovered = await snapshot(b, cookie);
    check(
      'replica B serves canonical state after the failover without a restart',
      Boolean(recovered.body?.data.incidents.some(incident => incident.title === title))
    );
    streamB.close();
  } finally {
    await prisma.incident.deleteMany({ where: { title: { startsWith: 'Replica check ' } } });
    await prisma.$disconnect();
  }
  const failed = results.filter(result => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
