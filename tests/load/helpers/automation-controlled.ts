import { captureControlledEnvironment, verifyControlledImage } from './automation-environment';
import {
  controlledMeasurementEnvironment,
  FROZEN_CERTIFICATION,
  requireSuccessfulMeasurement,
} from './automation-certification-integrity';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  controlledAutomationSchedule,
  assessControlledAutomationPair,
} from './automation-comparison';
import { createControlledSnapshot } from './automation-snapshot';

const exec = promisify(execFile);
async function main() {
  const measurementEnvironment = controlledMeasurementEnvironment(process.env);
  const topology = process.env.AUTOMATION_TOPOLOGY;
  if (!topology || !/^[a-z0-9-]+$/.test(topology))
    throw new Error('A dedicated controlled topology is required');
  if (process.env.AUTOMATION_RPS !== '20' || process.env.AUTOMATION_DURATION !== '120s')
    throw new Error('Controlled certification retains 20 RPS and 120-second measurements');
  const directory = path.resolve('artifacts/load-certification/automation', topology);
  await fs.mkdir(directory, { recursive: true });
  const provenance = JSON.parse(
    await fs.readFile(path.join(directory, 'kind-runtime.json'), 'utf8')
  ) as {
    sourceRevision: string;
    imageDigest: string;
    imageConfigDigest: string;
    loadGenerator?: { pod: string; imageConfigDigest: string };
  };
  if (
    !/^[a-f0-9]{40}$/.test(provenance.sourceRevision) ||
    !/^sha256:[a-f0-9]{64}$/.test(provenance.imageDigest)
  )
    throw new Error('Missing exact built-image provenance');
  const schedule = controlledAutomationSchedule();
  const snapshot = await createControlledSnapshot();
  const measurements: Array<{
    runId: string;
    pairId: string;
    profile: string;
    artifact: string;
    latency: { p95: number; p99: number };
    correctnessFailures: string[];
    environment: Awaited<ReturnType<typeof captureControlledEnvironment>>;
  }> = [];
  const pairs: Array<{
    pairId: string;
    result: ReturnType<typeof assessControlledAutomationPair>;
  }> = [];
  let status = 'INCOMPLETE';
  let lastFailure: { runId: string; exitCode: number | null; artifact: string } | null = null;
  async function save() {
    await fs.writeFile(
      path.join(directory, 'controlled-certification.json'),
      JSON.stringify(
        {
          status,
          lastFailure,
          certified: status === 'CERTIFIED',
          snapshot: snapshot.evidence,
          provenance,
          effectiveSettings: FROZEN_CERTIFICATION,
          recoveryDrill: false,
          latencyMeasure: 'end-to-end operation including attempts and retry backoff',
          schedule,
          limits: { latencyRatio: 1.25, baselineP95Drift: 0.15, baselineP99Drift: 0.2 },
          measurements,
          pairs,
          aggregation:
            'Every repetition must pass against both stable OFF baselines; no median hides failures',
        },
        null,
        2
      ) + '\n'
    );
  }
  await save();
  try {
    for (const run of schedule) {
      await snapshot.restore();
      const environment = await captureControlledEnvironment();
      await verifyControlledImage(provenance.imageConfigDigest, environment, provenance.loadGenerator);
      const childTopology = `${topology}-${run.runId}`;
      const childArtifact = path.join(
        'artifacts/load-certification/automation',
        childTopology,
        'certification.json'
      );
      try {
        await fs.access(childArtifact);
        throw new Error('Controlled measurement artifacts already exist; use a fresh topology');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      let childExitCode: number | null = 0;
      const child = await exec(
        'npx',
        [
          'ts-node',
          '-r',
          'tsconfig-paths/register',
          '--project',
          'tsconfig.script.json',
          'tests/load/helpers/automation-certify.ts',
        ],
        {
          env: {
            ...measurementEnvironment,
            AUTOMATION_CONTROLLED_SNAPSHOT: 'true',
            AUTOMATION_MEASUREMENT_PROFILE: run.profile,
            AUTOMATION_BASELINE_MODE: 'single',
            AUTOMATION_TOPOLOGY: childTopology,
            AUTOMATION_RESET_PROVIDER_TELEMETRY: 'true',
          },
          timeout: 20 * 60 * 1000,
          maxBuffer: 4 * 1024 * 1024,
        }
      ).catch(error => {
        childExitCode = typeof error.code === 'number' ? error.code : null;
        return { stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
      });
      await fs.writeFile(path.join(directory, `${run.runId}.log`), child.stdout + child.stderr);
      const artifact = path.join(
        'artifacts/load-certification/automation',
        childTopology,
        'certification.json'
      );
      const report = JSON.parse(await fs.readFile(artifact, 'utf8'));
      try {
        requireSuccessfulMeasurement(childExitCode, report);
      } catch (error) {
        lastFailure = { runId: run.runId, exitCode: childExitCode, artifact };
        await save();
        throw error;
      }
      if (report.certificationStatus !== 'MEASUREMENT_ONLY' || report.results.length !== 1)
        throw new Error('Controlled child did not produce exactly one isolated measurement');
      const result = report.results[0];
      const metric = result.summary.metrics.automation_ingestion_latency_ms;
      measurements.push({
        runId: run.runId,
        pairId: run.pairId,
        profile: run.profile,
        artifact,
        latency: { p95: metric['p(95)'], p99: metric['p(99)'] },
        correctnessFailures: report.comparisonGate.failures,
        environment,
      });
      if (run.position === 'OFF_B') {
        const bracket = measurements.slice(-3);
        pairs.push({
          pairId: run.pairId,
          result: assessControlledAutomationPair(
            bracket[0].latency,
            bracket[1].latency,
            bracket[2].latency
          ),
        });
      }
      await save();
      process.stdout.write(`Recorded controlled ${run.runId}\n`);
      if (report.comparisonGate.failures.length) {
        status = 'NOT_CERTIFIED';
        await save();
        throw new Error(
          'Controlled measurement failed correctness/recovery gates; see retained evidence'
        );
      }
    }
    status = pairs.some(p => p.result.status === 'INCONCLUSIVE')
      ? 'INCONCLUSIVE'
      : pairs.some(p => p.result.status === 'FAIL')
        ? 'NOT_CERTIFIED'
        : 'CERTIFIED';
    await save();
    if (status !== 'CERTIFIED') throw new Error(`Controlled certification ${status}`);
  } finally {
    // Retained artifacts own the measurements; leave no measured history in
    // the mutable fixture, including after a failed or incomplete child.
    try {
      await snapshot.restore();
    } finally {
      snapshot.close();
    }
  }
}
main().catch(error => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
