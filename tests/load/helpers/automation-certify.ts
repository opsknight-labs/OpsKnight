import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { configureAutomationLoadProfile } from './automation';
import { AUTOMATION_LOAD_PROFILES } from '../fixtures/automation';
import { collectSingleTelemetrySample } from './metrics';
import type { LoadSeedManifest } from './seed';
const exec = promisify(execFile);
const db = new PrismaClient();
const composeArgs = [
  'compose',
  '-p',
  'opsknight-automation-cert',
  '-f',
  'tests/load/deploy/compose/automation.yml',
];
async function runK6(profile: string, output: string) {
  const child = spawn(
    process.env.K6_BINARY || 'k6',
    ['run', '--summary-export', output, 'tests/load/scenarios/automation.js'],
    {
      env: {
        ...process.env,
        AUTOMATION_LOAD_PROFILE: profile,
        AUTOMATION_RUN_ID: String(Date.now()),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const chunks: string[] = [];
  child.stdout.on('data', chunk => chunks.push(String(chunk)));
  child.stderr.on('data', chunk => chunks.push(String(chunk)));
  let faultWork: Promise<unknown> | null = null;
  const fault =
    profile === 'live-small' && process.env.AUTOMATION_RECOVERY_DRILL === 'true'
      ? setTimeout(() => {
          faultWork = Promise.all(
            ['web', 'critical', 'general'].map(async role => {
              const namespace = process.env.AUTOMATION_K8S_NAMESPACE;
              if (namespace) {
                const component = role === 'web' ? role : `${role}-worker`;
                const { stdout } = await exec('kubectl', [
                  'get',
                  'pods',
                  '-n',
                  namespace,
                  '-l',
                  `app.kubernetes.io/component=${component}`,
                  '-o',
                  'jsonpath={.items[0].metadata.name}',
                ]);
                if (stdout.trim()) {
                  chunks.push(`Deleting one ${role} pod ${stdout.trim()}\n`);
                  await exec('kubectl', [
                    'delete',
                    'pod',
                    '-n',
                    namespace,
                    stdout.trim(),
                    '--grace-period=0',
                    '--force',
                    '--wait=false',
                  ]);
                }
              } else {
                const { stdout } = await exec('docker', [...composeArgs, 'ps', '-q', role]);
                const id = stdout.trim().split('\n')[0];
                if (id) {
                  chunks.push(`Restarting one ${role} replica ${id}\n`);
                  await exec('docker', ['restart', '--time', '0', id]);
                }
              }
            })
          );
        }, 5000)
      : null;
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (fault) clearTimeout(fault);
  if (faultWork) await faultWork;
  await fs.writeFile(output.replace('.json', '.log'), chunks.join(''));
  if (code !== 0) throw new Error(`k6 ${profile} failed (${code}); inspect ${output}`);
}
async function main() {
  if (process.env.OPSKNIGHT_LOAD_CERT_DB !== 'true')
    throw new Error('Use an explicitly isolated load database with OPSKNIGHT_LOAD_CERT_DB=true');
  const manifestPath = path.resolve(
    process.env.LOAD_SEED_MANIFEST || 'artifacts/load-certification/automation/seed-manifest.json'
  );
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as LoadSeedManifest;
  const actor = await db.user.findFirstOrThrow({
    where: { id: { in: manifest.userIds }, role: 'ADMIN' },
  });
  const topology = process.env.AUTOMATION_TOPOLOGY || 'compose-split';
  const outputDir = path.resolve('artifacts/load-certification/automation', topology);
  await fs.mkdir(outputDir, { recursive: true });
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const results = [];
  for (const profile of AUTOMATION_LOAD_PROFILES) {
    await configureAutomationLoadProfile(db, manifest.allServiceIds, actor.id, profile);
    const started = new Date();
    const summaryPath = path.join(outputDir, `${profile}.json`);
    await runK6(profile, summaryPath);
    const telemetry = await collectSingleTelemetrySample({
      prisma: db,
      topology,
      stage: profile,
      baseUrl: process.env.BASE_URL || manifest.baseUrl,
      controlBaseUrl: process.env.LOAD_EMULATOR_CONTROL_URL,
      metricsToken: process.env.LOAD_METRICS_TOKEN,
      k8sNamespace: process.env.AUTOMATION_K8S_NAMESPACE,
    });
    const traces = await db.automationTrace.findMany({
      where: { serviceId: { in: manifest.allServiceIds }, evaluationAt: { gte: started } },
      select: { durationMs: true, fallbackReason: true, detail: true },
    });
    const durations = traces.map(trace => trace.durationMs).sort((a, b) => a - b);
    const incidents = await db.incident.count({
      where: {
        serviceId: { in: manifest.allServiceIds },
        createdAt: { gte: started },
        title: 'Automation capacity certification',
      },
    });
    const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8')) as {
      metrics: { iterations: { count: number }; checks: { passes: number; fails: number } };
    };
    if (incidents !== summary.metrics.checks.passes)
      throw new Error(
        `Lost accepted event: ${incidents} incidents / ${summary.metrics.checks.passes} accepted`
      );
    const duplicates = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*)::bigint AS count FROM (SELECT "serviceId", "dedupKey" FROM "Incident" WHERE "createdAt" >= ${started} AND title = 'Automation capacity certification' GROUP BY "serviceId", "dedupKey" HAVING COUNT(*) > 1) duplicate_groups`;
    if (Number(duplicates[0].count) !== 0) throw new Error('Duplicate incidents');
    results.push({
      profile,
      acceptedEvents: incidents,
      duplicateGroups: 0,
      fallbackCount: traces.filter(trace => trace.fallbackReason).length,
      traceCount: traces.length,
      traceJsonBytes: traces.reduce(
        (bytes, trace) => bytes + Buffer.byteLength(JSON.stringify(trace.detail)),
        0
      ),
      evaluatorP99Ms: durations[Math.floor(durations.length * 0.99)] ?? null,
      summary,
      telemetry,
    });
    process.stdout.write(`Certified ${topology} ${profile}: ${incidents} accepted incidents\n`);
  }
  await fs.writeFile(
    path.join(outputDir, 'certification.json'),
    JSON.stringify({ topology, generatedAt: new Date().toISOString(), results }, null, 2) + '\n'
  );
}
main()
  .catch(error => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
