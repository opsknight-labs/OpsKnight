import { readFileSync as fsRead } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MCP_METRIC_GUIDE,
  MCP_STREAM_LIMITS,
  mcpAlertRules,
  renderMonitoring,
} from '../../scripts/mcp/docs-reference';
import { OPERATIONAL_METRICS } from '@/lib/metrics/operational/registry';
import {
  MAX_STREAMS_PER_GRANT,
  MAX_STREAMS_PER_PROCESS,
  STREAM_LIFETIME_MS,
} from '@/lib/mcp/protocol/subscriptions';

// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths only
const readFileSync = (path: string) => fsRead(path, 'utf8');

describe('OBS-1 / OBS-7: MCP monitoring is shipped and documented from the code', () => {
  it('explains exactly the opsknight_mcp_* metrics the registry defines', () => {
    const names = OPERATIONAL_METRICS.map(metric => metric.name as string)
      .filter(name => name.startsWith('opsknight_mcp_'))
      .sort();
    expect(Object.keys(MCP_METRIC_GUIDE).sort()).toEqual(names);
    const page = renderMonitoring();
    for (const name of names) expect(page).toContain(`\`${name}\``);
  });

  it('documents the stream caps the code enforces', () => {
    expect(MCP_STREAM_LIMITS).toEqual({
      perProcess: MAX_STREAMS_PER_PROCESS,
      perGrant: MAX_STREAMS_PER_GRANT,
      lifetimeMinutes: STREAM_LIFETIME_MS / 60_000,
    });
  });

  it('ships an MCP alert group whose every alert has a promtool test and a doc row', () => {
    const alerts = mcpAlertRules().map(rule => rule.alert);
    expect(alerts.length).toBeGreaterThanOrEqual(10);
    const tests = readFileSync('monitoring/prometheus/mcp.test.yml');
    const page = renderMonitoring();
    for (const alert of alerts) {
      expect(page, alert).toContain(`id="${alert}"`);
      // Prefix matches (OpsKnightMcp.*) do not count; every alert is asserted firing by name.
      expect(tests, alert).toContain(`alertname="${alert}"`);
    }
    for (const rule of mcpAlertRules()) expect(rule.labels?.severity, rule.alert).toBeTruthy();
  });

  it('runs the MCP promtool tests in CI and documents the page from the operate index', () => {
    const workflow = readFileSync('.github/workflows/runbook-validation.yml');
    expect(workflow).toContain('promtool" test rules monitoring/prometheus/mcp.test.yml');
    expect(workflow).toContain(
      'promtool" check rules monitoring/prometheus/opsknight-recording-rules.yaml'
    );
    expect(readFileSync('docs/v2.2.0/operate/mcp/README.md')).toContain('(monitoring.md)');
  });
});
