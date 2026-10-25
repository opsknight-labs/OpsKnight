/* eslint-disable @typescript-eslint/no-require-imports -- Executable native-image diagnostic. */
const assert = require('node:assert/strict');
const stages = new Set([
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
module.exports = { parseAdmissionStages, parseEventStages };

if (require.main === module) {
  const event = process.argv[2] === 'event';
  fetch('http://127.0.0.1:3000/api/metrics', {
    headers: { Authorization: 'Bearer ' + process.env.PROMETHEUS_SCRAPE_TOKEN },
    signal: AbortSignal.timeout(10000),
  })
    .then(async response => {
      assert.equal(response.status, 200);
      const stages = parseStages(await response.text(), event);
      assert.ok(
        event ||
          stages.some(
            row =>
              row.stage === 'transaction-finalize' && row.outcome === 'success' && row.count > 0
          )
      );
      process.stdout.write(JSON.stringify({ status: response.status, stages }));
    })
    .catch(() => {
      console.error('Admission metrics snapshot failed');
      process.exitCode = 1;
    });
}
