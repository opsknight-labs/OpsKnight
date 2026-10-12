import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createControlledSnapshot } from './automation-snapshot';
import { controlledMeasurementEnvironment } from './automation-certification-integrity';
import { captureControlledEnvironment } from './automation-environment';

const exec = promisify(execFile);
async function main() {
  const topology = process.env.AUTOMATION_TOPOLOGY;
  if (!topology || !/^[a-z0-9-]+$/.test(topology))
    throw new Error('A dedicated recovery topology is required');
  const env = controlledMeasurementEnvironment(process.env);
  const directory = path.resolve('artifacts/load-certification/automation', topology);
  const artifact = path.join(directory, 'certification.json');
  try {
    await fs.access(artifact);
    throw new Error('Recovery artifacts already exist');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const snapshot = await createControlledSnapshot();
  try {
    await snapshot.restore();
    const environment = await captureControlledEnvironment();
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
          ...env,
          AUTOMATION_CONTROLLED_SNAPSHOT: 'true',
          AUTOMATION_MEASUREMENT_PROFILE: 'live-small',
          AUTOMATION_RECOVERY_DRILL: 'true',
        },
        timeout: 20 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );
    const report = JSON.parse(await fs.readFile(artifact, 'utf8'));
    if (
      report.certificationStatus !== 'RECOVERY_MEASUREMENT_ONLY' ||
      report.results.length !== 1 ||
      report.comparisonGate.failures.length
    )
      throw new Error('Recovery report incomplete or correctness gates failed');
    await fs.writeFile(
      path.join(directory, 'recovery-validation.json'),
      JSON.stringify(
        {
          passed: true,
          scope:
            'Web, general and critical worker replica replacement; not a performance or PostgreSQL-recovery certification',
          environment,
          artifact,
          snapshot: snapshot.evidence,
        },
        null,
        2
      ) + '\n'
    );
    await fs.writeFile(path.join(directory, 'recovery.log'), child.stdout + child.stderr);
    // Leave the same clean seed for the following fault-free experiment.
    await snapshot.restore();
  } finally {
    snapshot.close();
  }
}
main().catch(error => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
