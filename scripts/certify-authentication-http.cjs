/* eslint-disable @typescript-eslint/no-require-imports -- Local Node certification CLI. */
'use strict';
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
async function main() {
  const origin = new URL(process.env.SSO_CERT_BASE_URL || 'https://localhost:3005');
  if (
    origin.protocol !== 'https:' ||
    origin.hostname !== 'localhost' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('This bounded probe permits only an explicit local HTTPS fixture origin.');
  if (!process.env.SSO_CERT_SESSION_STATE || !process.env.SSO_CERT_EXPECTED_USER_ID)
    throw new Error('Supply private fixture storage state and its expected User ID.');
  const expectedPolicyVersion = process.env.SSO_CERT_EXPECTED_POLICY_VERSION
    ? Number(process.env.SSO_CERT_EXPECTED_POLICY_VERSION)
    : null;
  if (
    expectedPolicyVersion != null &&
    (!Number.isSafeInteger(expectedPolicyVersion) || expectedPolicyVersion < 1)
  )
    throw new Error('Invalid expected policy version.');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: process.env.SSO_CERT_SESSION_STATE,
    });
    const results = [];
    for (const concurrency of [10, 25, 50]) {
      let next = 0;
      let errors = 0;
      const latencies = [];
      const start = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next++ < 100) {
            const before = performance.now();
            try {
              const response = await context.request.get(`${origin.origin}/api/auth/session`);
              const data = await response.json();
              if (
                response.status() !== 200 ||
                data.user?.id !== process.env.SSO_CERT_EXPECTED_USER_ID ||
                (expectedPolicyVersion != null &&
                  data.authenticationPolicyVersion !== expectedPolicyVersion)
              )
                errors++;
            } catch {
              errors++;
            }
            latencies.push(performance.now() - before);
          }
        })
      );
      latencies.sort((a, b) => a - b);
      results.push({
        concurrency,
        operations: 100,
        errors,
        durationMs: performance.now() - start,
        p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
        p99Ms: latencies[Math.ceil(latencies.length * 0.99) - 1],
      });
      if (errors) throw new Error('Protected session verification failed during local HTTP load.');
    }
    mkdirSync('plans/certification', { recursive: true });
    writeFileSync(
      'plans/certification/enterprise-sso-2.1-http-load.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          expectedPolicyVersion,
          scope:
            'Local TLS/HTTP session checks. Declared fixture routing and resource limits determine these diagnostic measurements; they are not a production capacity certificate.',
          results,
        },
        null,
        2
      ) + '\n'
    );
    console.log('300 local HTTP session checks passed, concurrency up to 50.');
  } finally {
    await browser.close();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
