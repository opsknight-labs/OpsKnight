'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const endpoint = new URL(process.env.MCP_BENCH_ENDPOINT ?? 'http://localhost:3042/mcp');
  const token = process.env.MCP_BENCH_ACCESS_TOKEN;
  const output = process.env.MCP_BENCH_OUTPUT;
  const concurrency = Number(process.env.MCP_BENCH_CONCURRENCY ?? 1);
  const count = Number(process.env.MCP_BENCH_REQUESTS ?? 100);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    endpoint.pathname !== '/mcp' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search
  )
    throw new Error('Benchmark only the owned local MCP endpoint');
  if (
    !token ||
    !output ||
    !path.relative(process.cwd(), path.resolve(output)).startsWith('..' + path.sep)
  )
    throw new Error('Provide an access token and an output path outside the repository');
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 100 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1000
  )
    throw new Error('Invalid bounded workload');
  const samples = [],
    statuses = new Map();
  let admitted = 0,
    next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const id = ++next;
        const before = performance.now();
        let status = 'network_error';
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2026-07-28',
              'mcp-method': 'tools/call',
              'mcp-name': 'incident_search',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id,
              method: 'tools/call',
              params: {
                name: 'incident_search',
                arguments: { query: { limit: 5 } },
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientInfo': {
                    name: 'owned-local-benchmark',
                    version: '1',
                  },
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              },
            }),
          });
          status = String(response.status);
          const body = await response.json();
          if (response.ok && body.result && !body.result.isError) admitted++;
        } catch {
          /* Record only a bounded outcome, never a credential-bearing request. */
        }
        samples.push(performance.now() - before);
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      }
    })
  );
  samples.sort((a, b) => a - b);
  const percentile = p => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)];
  const report = {
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
    ),
    measuredAt: new Date().toISOString(),
    node: process.version,
    scope:
      'Owned local MCP-only latency; not mixed-workload, HA, host compatibility or GA certification',
    concurrency,
    requests: count,
    admitted,
    statuses: Object.fromEntries(statuses),
    durationMs: performance.now() - started,
    latencyMsIncludingRejections: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    },
    certified: false,
  };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- explicit local evidence path, checked outside the repository above
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(
    `Recorded ${count} requests with concurrency ${concurrency}; ${admitted} successful tool results.\n`
  );
}
main().catch(() => {
  process.stderr.write(
    'Local MCP benchmark failed. Check endpoint, token, bounds and external output path.\n'
  );
  process.exitCode = 1;
});
