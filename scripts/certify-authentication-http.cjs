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
  const operations = 500;
  const rounds = 3;
  const warmupOperations = 100;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: process.env.SSO_CERT_SESSION_STATE,
    });
    const results = [];
    async function sample(concurrency, count) {
      let next = 0;
      let errors = 0;
      const latencies = [];
      const start = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next++ < count) {
            const before = performance.now();
            let response;
            try {
              response = await context.request.get(`${origin.origin}/api/auth/session`, {
                timeout: 10000,
              });
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
            } finally {
              await response?.dispose();
            }
            latencies.push(performance.now() - before);
          }
        })
      );
      const durationMs = performance.now() - start;
      latencies.sort((a, b) => a - b);
      return {
        concurrency,
        operations: count,
        errors,
        durationMs,
        requestsPerSecond: (count * 1000) / durationMs,
        p50Ms: latencies[Math.ceil(latencies.length * 0.5) - 1],
        p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
        p99Ms: latencies[Math.ceil(latencies.length * 0.99) - 1],
      };
    }
    const initialRequest = await sample(1, 1);
    if (initialRequest.errors) throw new Error('Initial protected session check failed.');
    for (const concurrency of [1, 10, 25, 50]) {
      const warmup = await sample(concurrency, warmupOperations);
      if (warmup.errors) throw new Error('Warmup protected session verification failed.');
      for (let round = 1; round <= rounds; round++) {
        const result = await sample(concurrency, operations);
        results.push({ round, ...result });
        if (result.errors)
          throw new Error('Protected session verification failed during local HTTP load.');
      }
    }
    mkdirSync('plans/certification', { recursive: true });
    writeFileSync(
      'plans/certification/enterprise-sso-2.1-http-steady-state.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          expectedPolicyVersion,
          initialRequest,
          warmupOperationsPerConcurrency: warmupOperations,
          rounds,
          client:
            'Playwright request API with response disposal; latency includes client IPC and JSON validation.',
          scope:
            'Local TLS/HTTP session checks. Declared fixture routing and resource limits determine these diagnostic measurements; they are not a production capacity certificate.',
          results,
        },
        null,
        2
      ) + '\n'
    );
    console.log(
      '6,000 measured local HTTP session checks passed after 400 warmup requests, concurrency up to 50.'
    );
  } finally {
    await browser.close();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
