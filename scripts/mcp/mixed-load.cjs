'use strict';
// Measures ingestion with concurrent MCP read load in a separate process. Local evidence only.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = (process.env.MCP_LOAD_LEVELS || '0,10,25,50,100').split(',').map(Number);
// Release thresholds for this harness: MCP must not push ingestion beyond these bounds.
const MAX_P95_RATIO = Number(process.env.MCP_LOAD_MAX_P95_RATIO || 2);
const MIN_THROUGHPUT_RATIO = Number(process.env.MCP_LOAD_MIN_THROUGHPUT_RATIO || 0.5);

function run(command, args, env, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => {
      out += chunk;
      for (const line of String(chunk).split('\n')) if (line && onLine) onLine(line, child);
    });
    child.stderr.on('data', chunk => (err += chunk));
    child.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(`${args[0]} exited ${code}: ${err.slice(-2000)}`))));
    if (onLine) onLine.child = child;
  });
}

async function ingestion() {
  // The benchmark logs to stdout; its evidence file is the reliable result.
  const file = path.join(require('node:os').tmpdir(), `mcp-mixed-ingestion-${process.pid}.json`);
  await run(process.execPath, ['scripts/ingestion/benchmark.cjs', file], {
    INGESTION_BENCHMARK_EVENTS: process.env.INGESTION_BENCHMARK_EVENTS || '200',
  });
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.unlinkSync(file);
  const of = mode => json.results.find(row => row.mode === mode && row.keys === 'many-key');
  return { sync: of('sync'), durable: of('postgres') };
}

(async () => {
  const output = process.argv[2];
  if (!output || !path.relative(process.cwd(), path.resolve(output)).startsWith('..'))
    throw new Error('Provide an output path outside the repository');
  const levels = [];
  for (const concurrency of LEVELS) {
    if (concurrency === 0) {
      levels.push({ mcpConcurrency: 0, ingestion: await ingestion(), mcp: null });
      process.stderr.write('level 0 done\n');
      continue;
    }
    // The MCP reads run under the test runtime (Next route shims) in their own OS process.
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mcp-load-'));
    const files = {
      MCP_LOAD_READY_FILE: path.join(dir, 'ready'),
      MCP_LOAD_STOP_FILE: path.join(dir, 'stop'),
      MCP_LOAD_RESULT_FILE: path.join(dir, 'result.json'),
    };
    const worker = run(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.int.config.ts', '--no-file-parallelism', '--maxWorkers=1', 'tests/integration/mcp-load-worker.test.ts'],
      { MCP_LOAD_CHILD: '1', MCP_LOAD_CONCURRENCY: String(concurrency), ...files }
    );
    let failed = null;
    worker.catch(error => (failed = error));
    while (!fs.existsSync(files.MCP_LOAD_READY_FILE)) {
      if (failed) throw failed;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await ingestion();
    fs.writeFileSync(files.MCP_LOAD_STOP_FILE, 'stop');
    await worker;
    const load = JSON.parse(fs.readFileSync(files.MCP_LOAD_RESULT_FILE, 'utf8'));
    fs.rmSync(dir, { recursive: true, force: true });
    levels.push({ mcpConcurrency: concurrency, ingestion: result, mcp: load });
    process.stderr.write(`level ${concurrency} done\n`);
  }
  const base = levels[0].ingestion;
  const verdicts = levels.map(level => {
    const p95Ratio = level.ingestion.sync.acknowledgementLatencyMs.p95 / base.sync.acknowledgementLatencyMs.p95;
    const durableP95Ratio = level.ingestion.durable.acknowledgementLatencyMs.p95 / base.durable.acknowledgementLatencyMs.p95;
    const throughputRatio = level.ingestion.durable.drainedCompletionRps / base.durable.drainedCompletionRps;
    return {
      mcpConcurrency: level.mcpConcurrency,
      syncP95Ratio: Number(p95Ratio.toFixed(2)),
      durableP95Ratio: Number(durableP95Ratio.toFixed(2)),
      durableThroughputRatio: Number(throughputRatio.toFixed(2)),
      reconciled: level.ingestion.sync.reconciled && level.ingestion.durable.reconciled,
      withinBounds:
        level.ingestion.sync.reconciled &&
        level.ingestion.durable.reconciled &&
        p95Ratio <= MAX_P95_RATIO &&
        durableP95Ratio <= MAX_P95_RATIO &&
        throughputRatio >= MIN_THROUGHPUT_RATIO,
    };
  });
  const evidence = {
    measuredAt: new Date().toISOString(),
    scope:
      'Local single-host PostgreSQL; ingestion library path in one process, MCP executor reads in another through the isolated MCP pool. Not production certification.',
    certified: false,
    thresholds: { maxP95Ratio: MAX_P95_RATIO, minThroughputRatio: MIN_THROUGHPUT_RATIO },
    verdicts,
    levels,
  };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ verdicts }, null, 2) + '\n');
  if (verdicts.some(v => !v.withinBounds)) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
