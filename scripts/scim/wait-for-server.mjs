/* eslint-disable security/detect-non-literal-fs-filename -- Explicit local certification log/PID paths supplied by the workflow. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const [origin, logPath, pidPath] = process.argv.slice(2);
const url = new URL(origin);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.equal(url.protocol, 'http:');
const pid = Number(readFileSync(pidPath, 'utf8').trim());
assert.ok(Number.isSafeInteger(pid) && pid > 0);
let lastFailure = 'No successful readiness response.';
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    // Fail immediately if instrumentation/production validation exits the server.
    process.kill(pid, 0);
    // Next can keep its process alive after instrumentation has already failed.
    let startupLog = '';
    try {
      startupLog = readFileSync(logPath, 'utf8');
    } catch {
      /* Log not created yet. */
    }
    if (/Failed to prepare server|PRODUCTION CONFIGURATION ERROR/.test(startupLog))
      throw new Error('Production server initialization failed.');
    try {
      const response = await fetch(new URL('/login', url), {
        signal: AbortSignal.timeout(2000),
        redirect: 'manual',
      });
      if (response.status === 200) {
        console.log(`Standalone SCIM fixture ready at ${url.origin}.`);
        process.exit(0);
      }
      lastFailure = `Readiness returned HTTP ${response.status}.`;
      await response.body?.cancel();
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(lastFailure);
} catch (error) {
  console.error(
    `SCIM fixture did not start at ${url.origin}: ${error instanceof Error ? error.message : String(error)}`
  );
  console.error(`Server log tail (${logPath}):`);
  try {
    console.error(readFileSync(logPath, 'utf8').split('\n').slice(-80).join('\n'));
  } catch {
    console.error('Server log unavailable.');
  }
  process.exitCode = 1;
}
