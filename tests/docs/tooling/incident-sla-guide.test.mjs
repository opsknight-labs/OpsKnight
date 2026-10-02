import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const guide = readFileSync('docs/v2.0.0/guides/incidents/configure-incident-sla.md', 'utf8');

test('incident SLA guide covers the complete policy lifecycle', () => {
  for (const phrase of [
    'provider severity → notification urgency → response priority → ACK/resolve targets',
    'SLA Objectives (P1–P5)',
    'Fallback acknowledgement',
    'Inherit workspace defaults',
    'Use urgency fallback',
    'No automatic priority',
    'HIGH → P1',
    'MEDIUM → P3',
    'LOW → P5',
    'Severity default',
    'Understand classification precedence',
    'Support hours never pause incident SLA clocks',
    'Effective Policy Simulation',
    'Source recovers before ACK deadline',
    'Manually resolved without ACK',
    'Production rollout checklist',
    'Roll back or change',
  ]) {
    assert.ok(guide.includes(phrase), `SLA guide missing: ${phrase}`);
  }
});
