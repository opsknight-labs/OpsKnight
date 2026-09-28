#!/usr/bin/env node
/**
 * OpsKnight 10-Minute Single-Image (Integrated Runtime) Load & Capacity Test
 * 
 * Evaluates the performance boundaries, concurrency limits, and breaking point
 * of the single-image (integrated web + worker + scheduler without PgBouncer) topology:
 * - Docker Compose Single: http://127.0.0.1:34000
 * - Kind K8s Single:       http://127.0.0.1:34080
 * 
 * Stages:
 * - Stage 1 (00:00 - 02:00 / 120s): Low Baseline (30 RPS, Concurrency 5)
 * - Stage 2 (02:00 - 05:00 / 180s): Moderate Enterprise (100 RPS, Concurrency 20)
 * - Stage 3 (05:00 - 08:00 / 180s): High Stress (300 RPS, Concurrency 60 - Exceeds 40 conn limit)
 * - Stage 4 (08:00 - 10:00 / 120s): Extreme Saturation Breaking Point (600 RPS, Concurrency 100)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COMPOSE_URL = process.env.SINGLE_COMPOSE_URL || 'http://127.0.0.1:34000';
const KIND_URL = process.env.SINGLE_KIND_URL || 'http://127.0.0.1:34080';
const TOTAL_DURATION_SEC = Number(process.env.TOTAL_DURATION_SEC || 600); // 10 minutes

const LOG_DIR = path.resolve(__dirname, '../artifacts/single-image-test-10m');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const METRICS_CSV = path.join(LOG_DIR, 'single_metrics.csv');
const SUMMARY_MD = path.join(LOG_DIR, 'single_test_summary.md');

fs.writeFileSync(
  METRICS_CSV,
  'timestamp,elapsed_sec,stage,target_rps,compose_sent,compose_2xx,compose_err,compose_p50_ms,compose_p95_ms,compose_max_ms,compose_mem_mb,compose_db_conns,kind_sent,kind_2xx,kind_err,kind_p50_ms,kind_p95_ms,kind_max_ms,kind_mem_mb,kind_restarts\n'
);

const composeAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const kindAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });

function getStageConfig(elapsedSec) {
  if (elapsedSec < 120) {
    return { name: '1. Baseline Low Load', rps: 30, concurrency: 5 };
  } else if (elapsedSec < 300) {
    return { name: '2. Moderate Enterprise Load', rps: 100, concurrency: 20 };
  } else if (elapsedSec < 480) {
    return { name: '3. High Stress (Connection Saturation)', rps: 300, concurrency: 60 };
  } else {
    return { name: '4. Extreme Breaking Point Shock', rps: 600, concurrency: 100 };
  }
}

function sampleTelemetry() {
  let composeMemMb = 0;
  let composeDbConns = 0;
  let kindMemMb = 0;
  let kindRestarts = 0;

  try {
    const rawMem = execSync(
      'docker stats --no-stream --format "{{.MemUsage}}" opsknight-single-opsknight-app-1 2>/dev/null || echo "0MiB"',
      { encoding: 'utf8' }
    ).trim();
    const match = rawMem.match(/([0-9.]+)(MiB|GiB)/);
    if (match) {
      composeMemMb = match[2] === 'GiB' ? parseFloat(match[1]) * 1024 : parseFloat(match[1]);
    }
  } catch (_) {}

  try {
    const rawConns = execSync(
      'docker exec opsknight-single-opsknight-db-1 psql -U opsknight -d opsknight_db -t -A -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null || echo "0"',
      { encoding: 'utf8' }
    ).trim();
    composeDbConns = parseInt(rawConns, 10) || 0;
  } catch (_) {}

  try {
    const rawTop = execSync(
      'kubectl top pods -n opsknight-single -l app.kubernetes.io/name=opsknight --no-headers 2>/dev/null || true',
      { encoding: 'utf8' }
    );
    const mems = rawTop.split('\n').filter(Boolean).map(l => {
      const parts = l.trim().split(/\s+/);
      const m = (parts[2] || '').replace('Mi', '');
      return parseInt(m, 10) || 0;
    });
    if (mems.length > 0) {
      kindMemMb = Math.max(...mems);
    }
  } catch (_) {}

  try {
    const rawRestarts = execSync(
      'kubectl get pods -n opsknight-single -l app.kubernetes.io/name=opsknight --no-headers 2>/dev/null | awk \'{sum+=$4} END {print sum+0}\'',
      { encoding: 'utf8' }
    ).trim();
    kindRestarts = parseInt(rawRestarts, 10) || 0;
  } catch (_) {}

  return { composeMemMb: Math.round(composeMemMb), composeDbConns, kindMemMb: Math.round(kindMemMb), kindRestarts };
}

function sendProbe(url, agent) {
  return new Promise(resolve => {
    const start = process.hrtime.bigint();
    const req = http.get(
      `${url}/api/health?mode=readiness`,
      {
        agent,
        headers: { 'X-OpsKnight-Load': 'single-image-benchmark' },
        timeout: 4000,
      },
      res => {
        res.resume();
        res.on('end', () => {
          const durMs = Number(process.hrtime.bigint() - start) / 1e6;
          resolve({ status: res.statusCode, ok: res.statusCode === 200, durMs });
        });
      }
    );
    req.on('error', err => {
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 0, ok: false, durMs, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 504, ok: false, durMs, error: 'TIMEOUT' });
    });
  });
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p95: 0, max: 0 };
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const max = latencies[latencies.length - 1] || 0;
  return { p50: Math.round(p50), p95: Math.round(p95), max: Math.round(max) };
}

async function main() {
  console.log('========================================================================');
  console.log('Starting OpsKnight 10-Minute Single-Image Capacity & Saturation Test');
  console.log(`Single Compose: ${COMPOSE_URL}`);
  console.log(`Single Kind K8s: ${KIND_URL}`);
  console.log(`Duration:       ${TOTAL_DURATION_SEC}s (${Math.round(TOTAL_DURATION_SEC / 60)} minutes)`);
  console.log('Stages:');
  console.log('  1. 00:00 - 02:00: Baseline Low Load (30 RPS)');
  console.log('  2. 02:00 - 05:00: Moderate Enterprise Load (100 RPS)');
  console.log('  3. 05:00 - 08:00: High Stress / Connection Saturation (300 RPS)');
  console.log('  4. 08:00 - 10:00: Extreme Breaking Point Shock (600 RPS)');
  console.log('========================================================================\n');

  const startTime = Date.now();
  let currentStageName = '';
  const globalStats = {
    composeTotal: 0,
    compose2xx: 0,
    composeErrors: 0,
    kindTotal: 0,
    kind2xx: 0,
    kindErrors: 0,
    peakComposeMemMb: 0,
    peakKindMemMb: 0,
    maxDbConns: 0,
  };

  while (true) {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    if (elapsedSec >= TOTAL_DURATION_SEC) break;

    const stage = getStageConfig(elapsedSec);
    if (stage.name !== currentStageName) {
      currentStageName = stage.name;
      console.log(`\n>>> [STAGE TRANSITION @ ${elapsedSec}s] Entering: ${currentStageName} (${stage.rps} RPS, concurrency ${stage.concurrency})\n`);
    }

    const secondStart = Date.now();
    const batchSize = Math.max(1, Math.round(stage.rps / 4));
    const composeLatencies = [];
    const kindLatencies = [];
    let comp2xx = 0;
    let compErr = 0;
    let k2xx = 0;
    let kErr = 0;

    for (let sub = 0; sub < 4; sub++) {
      const promises = [];
      for (let i = 0; i < batchSize; i++) {
        promises.push(
          sendProbe(COMPOSE_URL, composeAgent).then(res => {
            composeLatencies.push(res.durMs);
            if (res.ok) comp2xx++;
            else compErr++;
          }),
          sendProbe(KIND_URL, kindAgent).then(res => {
            kindLatencies.push(res.durMs);
            if (res.ok) k2xx++;
            else kErr++;
          })
        );
      }
      await Promise.all(promises);
      const subElapsed = Date.now() - secondStart;
      const targetSubTime = (sub + 1) * 250;
      if (subElapsed < targetSubTime) {
        await new Promise(r => setTimeout(r, targetSubTime - subElapsed));
      }
    }

    const compP = calculatePercentiles(composeLatencies);
    const kindP = calculatePercentiles(kindLatencies);
    const telem = sampleTelemetry();

    globalStats.composeTotal += (comp2xx + compErr);
    globalStats.compose2xx += comp2xx;
    globalStats.composeErrors += compErr;
    globalStats.kindTotal += (k2xx + kErr);
    globalStats.kind2xx += k2xx;
    globalStats.kindErrors += kErr;
    if (telem.composeMemMb > globalStats.peakComposeMemMb) globalStats.peakComposeMemMb = telem.composeMemMb;
    if (telem.kindMemMb > globalStats.peakKindMemMb) globalStats.peakKindMemMb = telem.kindMemMb;
    if (telem.composeDbConns > globalStats.maxDbConns) globalStats.maxDbConns = telem.composeDbConns;

    const timestamp = new Date().toISOString();
    const csvLine = `${timestamp},${elapsedSec},"${stage.name}",${stage.rps},${comp2xx + compErr},${comp2xx},${compErr},${compP.p50},${compP.p95},${compP.max},${telem.composeMemMb},${telem.composeDbConns},${k2xx + kErr},${k2xx},${kErr},${kindP.p50},${kindP.p95},${kindP.max},${telem.kindMemMb},${telem.kindRestarts}\n`;
    fs.appendFileSync(METRICS_CSV, csvLine);

    const minStr = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secStr = String(elapsedSec % 60).padStart(2, '0');
    console.log(
      `[${minStr}:${secStr} | ${stage.name}] ` +
      `Compose: ${comp2xx}/${comp2xx + compErr} ok (p50: ${compP.p50}ms, p95: ${compP.p95}ms, mem: ${telem.composeMemMb}M, conns: ${telem.composeDbConns}) | ` +
      `Kind: ${k2xx}/${k2xx + kErr} ok (p50: ${kindP.p50}ms, p95: ${kindP.p95}ms, mem: ${telem.kindMemMb}M, restarts: ${telem.kindRestarts})`
    );

    if (elapsedSec % 20 === 0 || elapsedSec >= TOTAL_DURATION_SEC - 2) {
      writeSummaryReport(elapsedSec, stage.name, globalStats, telem);
    }
  }

  console.log('\n========================================================================');
  console.log('10-Minute Single-Image Load Test Complete!');
  console.log(`Summary report: ${SUMMARY_MD}`);
  console.log(`Metrics CSV:    ${METRICS_CSV}`);
  console.log('========================================================================');
}

function writeSummaryReport(elapsedSec, currentStage, stats, telem) {
  const compAvail = stats.composeTotal > 0 ? ((stats.compose2xx / stats.composeTotal) * 100).toFixed(2) : '100.00';
  const kindAvail = stats.kindTotal > 0 ? ((stats.kind2xx / stats.kindTotal) * 100).toFixed(2) : '100.00';

  const md = `# OpsKnight 10-Minute Single-Image Capacity & Saturation Report

- **Elapsed Time**: ${elapsedSec}s / ${TOTAL_DURATION_SEC}s (${Math.round((elapsedSec / TOTAL_DURATION_SEC) * 100)}%)
- **Current Active Stage**: \`${currentStage}\`
- **Topology**: Integrated Single-Image (Web + All Background Workers in 1 Container, Direct DB Connection, NO PgBouncer)

---

## 1. Executive Summary

| Deployment Topology | Total Requests | Successful (2xx) | Errors / Dropped | Availability | Peak Memory | Max DB Conns / Restarts |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Single-Image Compose** | ${stats.composeTotal.toLocaleString()} | ${stats.compose2xx.toLocaleString()} | ${stats.composeErrors} | **${compAvail}%** | ${stats.peakComposeMemMb} MiB | ${stats.maxDbConns} connections |
| **Single-Image Kind K8s** | ${stats.kindTotal.toLocaleString()} | ${stats.kind2xx.toLocaleString()} | ${stats.kindErrors} | **${kindAvail}%** | ${stats.peakKindMemMb} MiB (Limit: 1Gi) | ${telem.kindRestarts} restarts |
`;

  fs.writeFileSync(SUMMARY_MD, md);
}

main().catch(err => {
  console.error('Fatal single-image load runner error:', err);
  process.exit(1);
});
