import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const defaults = readFileSync('src/lib/notification-capacity/defaults.ts', 'utf8');
const limits = readFileSync('src/lib/notification-capacity/hard-limits.ts', 'utf8');
const reference = readFileSync('docs/v2.0.0/reference/notifications/rate-limits.md', 'utf8');

const expected = [
  ['EMAIL', 'Email', 8, 5], ['SMS', 'SMS', 20, 10],
  ['VOICE', 'Voice', 1, 2], ['WHATSAPP', 'WhatsApp', 50, 10],
  ['PUSH', 'Push', 100, 20], ['SLACK', 'Slack', 1, 2],
  ['WEBHOOK', 'Webhook', 20, 10], ['MICROSOFT_TEAMS', 'Microsoft Teams', 2, 2],
];

test('published notification defaults match executable source', () => {
  for (const [constant, label, rate, inFlight] of expected) {
    const rateBlock = defaults.match(new RegExp(`case '${constant}':[\\s\\S]*?return (\\d+);`));
    const inFlightSource = defaults.slice(defaults.indexOf('export function defaultInFlight'));
    const inFlightBlock = inFlightSource.match(new RegExp(`case '${constant}':[\\s\\S]*?return (\\d+);`));
    assert.equal(Number(rateBlock?.[1]), rate, `${constant} rate source changed`);
    assert.equal(Number(inFlightBlock?.[1]), inFlight, `${constant} in-flight source changed`);
    assert.match(reference, new RegExp(`\\| ${label} \\| ${rate.toLocaleString('en-US')} \\| ${inFlight.toLocaleString('en-US')} \\|`));
  }
});

test('published notification hard ceilings match executable source', () => {
  assert.match(limits, /ratePerSecond: \{ min: 1, max: 10_000 \}/);
  assert.match(limits, /maxInFlight: \{ min: 1, max: 5_000 \}/);
  assert.match(reference, /\| Rate per second \| 1 \| 10,000 \|/);
  assert.match(reference, /\| Maximum in flight \| 1 \| 5,000 \|/);
});
