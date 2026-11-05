import { readFileSync as fsRead } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPERATIONAL_METRICS } from '@/lib/metrics/operational/registry';

const dashboard = JSON.parse(fsRead('monitoring/grafana/opsknight-mcp.json', 'utf8')) as {
  title: string;
  panels: { title: string; targets: { expr: string }[] }[];
};

describe('the shipped MCP Grafana dashboard', () => {
  const known = new Set(OPERATIONAL_METRICS.map(metric => metric.name as string));

  it('queries only opsknight_mcp_* metrics the registry defines', () => {
    const used = new Set(
      dashboard.panels
        .flatMap(panel => panel.targets.map(target => target.expr))
        .flatMap(expr => expr.match(/opsknight_mcp_[a-z0-9_]+/g) ?? [])
        // A histogram is queried through its _bucket series.
        .map(name => name.replace(/_(bucket|sum|count)$/, ''))
    );
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(known.has(name), name).toBe(true);
  });

  it('covers the signals the alerts watch', () => {
    const text = JSON.stringify(dashboard);
    for (const signal of [
      'opsknight_mcp_requests_total',
      'opsknight_mcp_request_duration_seconds_bucket',
      'opsknight_mcp_queued',
      'opsknight_mcp_busy_total',
      'opsknight_mcp_subscriptions_active',
      'opsknight_mcp_call_log_dropped_total',
    ])
      expect(text, signal).toContain(signal);
  });

  it('never filters or groups by a person, client or grant', () => {
    const exprs = dashboard.panels
      .flatMap(panel => panel.targets.map(target => target.expr))
      .join('\n');
    expect(exprs).not.toMatch(/\b(user|client|grant)[A-Za-z]*\b\s*[=!~]/i);
    expect(exprs).not.toMatch(/by \([^)]*(user|client|grant)/i);
  });

  it('has unique panel titles', () => {
    const titles = dashboard.panels.map(panel => panel.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
