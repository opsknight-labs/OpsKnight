/* eslint-disable @typescript-eslint/no-require-imports -- Executable native-image diagnostic. */
const assert = require('node:assert/strict');
const stages = new Set([
  'request-wait',
  'authentication',
  'body-read',
  'body-parse',
  'validation',
  'quota-wait',
  'quota-policy',
  'quota-database',
  'quota',
  'envelope',
  'hashing',
  'byte-count',
  'append-wait',
  'durability',
  'advisory',
  'idempotency',
  'policy',
  'automation',
  'preparation',
  'reservation',
  'insert',
  'transaction-acquire',
  'transaction-operation',
  'transaction-finalize',
  'transaction-backoff',
]);

function parseStages(body, event = false) {
  const groups = new Map();
  for (const line of body.split('\n')) {
    const match =
      /^opsknight_(ingestion_admission|event)_stage_duration_ms_(bucket|sum|count)\{([^}]*)\} ([^\s]+)$/.exec(
        line
      );
    if (!match || match[1] !== (event ? 'event' : 'ingestion_admission')) continue;
    const labels = new Map(
      [...match[3].matchAll(/(\w+)="([^"]*)"/g)].map(pair => [pair[1], pair[2]])
    );
    assert.ok(stages.has(labels.get('stage')));
    if (event) assert.ok(labels.get('stage').startsWith('transaction-'));
    assert.ok(['success', 'failure'].includes(labels.get('outcome')));
    assert.ok([...labels.keys()].every(label => ['stage', 'outcome', 'le'].includes(label)));
    const value = Number(match[4]);
    assert.ok(Number.isFinite(value) && value >= 0);
    const key = `${labels.get('stage')}:${labels.get('outcome')}`;
    const row = groups.get(key) || {
      stage: labels.get('stage'),
      outcome: labels.get('outcome'),
      buckets: [],
    };
    if (match[2] === 'bucket') {
      const upperBoundMs = labels.get('le') === '+Inf' ? null : Number(labels.get('le'));
      assert.ok(upperBoundMs === null || Number.isFinite(upperBoundMs));
      row.buckets.push({ upperBoundMs, cumulativeCount: value });
    } else if (match[2] === 'sum') row.sumMs = value;
    else row.count = value;
    groups.set(key, row);
  }
  return [...groups.values()];
}
const parseAdmissionStages = body => parseStages(body);
const parseEventStages = body => parseStages(body, true);

function parseAdmissionCounters(body) {
  const rows = [];
  for (const line of body.split('\n')) {
    const separator = line.lastIndexOf(' ');
    if (separator < 0) continue;
    const series = line.slice(0, separator);
    const brace = series.indexOf('{');
    const name = brace < 0 ? series : series.slice(0, brace);
    if (
      ![
        'opsknight_ingestion_request_overload_total',
        'opsknight_ingestion_capacity_contention_total',
        'opsknight_ingestion_capacity_rejections_total',
        'opsknight_ingestion_capacity_reservation_retries_total',
      ].includes(name)
    )
      continue;
    assert.ok(brace < 0 || series.endsWith('}'));
    const match = [
      line,
      name,
      brace < 0 ? '' : series.slice(brace + 1, -1),
      line.slice(separator + 1),
    ];
    const labels = Object.fromEntries(
      [...(match[2] ?? '').matchAll(/(\w+)="([^"]*)"/g)].map(pair => [pair[1], pair[2]])
    );
    const reasons = match[1] === 'opsknight_ingestion_capacity_rejections_total';
    assert.deepEqual(Object.keys(labels).sort(), reasons ? ['reason'] : []);
    if (reasons) assert.ok(['full', 'contended'].includes(labels.reason));
    const value = Number(match[3]);
    assert.ok(Number.isFinite(value) && value >= 0);
    rows.push({ name: match[1], labels, value });
  }
  return rows;
}
// Bucket upper bounds are deliberately reported, not invented exact percentiles.
// Async spans can overlap and retries can repeat stages: do not add their means.
function summarizeStages(rows) {
  return rows.map(row => {
    const buckets = [...row.buckets].sort(
      (a, b) => (a.upperBoundMs ?? Infinity) - (b.upperBoundMs ?? Infinity)
    );
    const bound = q => {
      if (!row.count) return null;
      const bucket = buckets.find(bucket => bucket.cumulativeCount >= row.count * q);
      return bucket?.upperBoundMs ?? null;
    };
    return {
      stage: row.stage,
      outcome: row.outcome,
      count: row.count,
      meanMs: row.count && Number.isFinite(row.sumMs) ? row.sumMs / row.count : null,
      percentileUpperBoundsMs: { p50: bound(0.5), p95: bound(0.95), p99: bound(0.99) },
    };
  });
}
module.exports = {
  parseAdmissionStages,
  parseEventStages,
  summarizeStages,
  parseAdmissionCounters,
};

if (require.main === module) {
  const event = process.argv[2] === 'event';
  fetch('http://127.0.0.1:3000/api/metrics', {
    headers: { Authorization: 'Bearer ' + process.env.PROMETHEUS_SCRAPE_TOKEN },
    signal: AbortSignal.timeout(10000),
  })
    .then(async response => {
      assert.equal(response.status, 200);
      const body = await response.text();
      const stages = parseStages(body, event);
      assert.ok(
        event ||
          stages.some(
            row =>
              row.stage === 'transaction-finalize' && row.outcome === 'success' && row.count > 0
          )
      );
      process.stdout.write(
        JSON.stringify({
          status: response.status,
          stages,
          summary: summarizeStages(stages),
          counters: event ? [] : parseAdmissionCounters(body),
        })
      );
    })
    .catch(() => {
      console.error('Admission metrics snapshot failed');
      process.exitCode = 1;
    });
}
