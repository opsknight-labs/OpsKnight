import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createControlledSnapshot } from './automation-snapshot';
import {
  controlledMeasurementEnvironment,
  requireSuccessfulRecovery,
} from './automation-certification-integrity';
import { captureControlledEnvironment, verifyControlledImage } from './automation-environment';

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
    const provenance = JSON.parse(
      await fs.readFile(path.join(directory, 'kind-runtime.json'), 'utf8')
    ) as { imageConfigDigest: string };
    await verifyControlledImage(provenance.imageConfigDigest, environment);
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
          ...env,
          AUTOMATION_CONTROLLED_SNAPSHOT: 'true',
          AUTOMATION_MEASUREMENT_PROFILE: 'live-small',
          AUTOMATION_RECOVERY_DRILL: 'true',
        },
        timeout: 20 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
      }
    ).catch(error => {
      childExitCode = typeof error.code === 'number' ? error.code : null;
      return { stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    });
    await fs.writeFile(path.join(directory, 'recovery.log'), child.stdout + child.stderr);
    // Save provenance even when the child fails or produces no usable report.
    const validation = {
      passed: false,
      scope:
        'Web, general and critical worker replica replacement; not a performance or PostgreSQL-recovery certification',
      childExitCode,
      environment,
      artifact,
      snapshot: snapshot.evidence,
    };
    const validationPath = path.join(directory, 'recovery-validation.json');
    await fs.writeFile(validationPath, JSON.stringify(validation, null, 2) + '\n');
    const report = JSON.parse(await fs.readFile(artifact, 'utf8'));
    requireSuccessfulRecovery(childExitCode, report);
    await fs.writeFile(
      validationPath,
      JSON.stringify(
        {
          ...validation,
          passed: true,
        },
        null,
        2
      ) + '\n'
    );
  } finally {
    // Failed drills must also leave a clean seed for the independent comparison.
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
