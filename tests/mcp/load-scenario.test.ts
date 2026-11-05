import { readFileSync as fsRead } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, isMcpExecutable } from '@/lib/mcp/catalog';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import { MCP_LOAD_SCOPES } from '../load/helpers/mcp-seed';

// Repository paths only: the k6 scenario, the topology runner and package.json.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths only
const read = (path: string) => fsRead(path, 'utf8');

/**
 * OBS-10 / CERT-04: k6 cannot run under vitest, so this pins what the scenario sends to what the
 * server actually serves. A renamed tool or operation, or a scope the seeded grants lack, would
 * otherwise only show up as a red load run.
 */
describe('k6 MCP assistants scenario', () => {
  const scenario = read('tests/load/scenarios/mcp-assistants.js');

  it('calls only tools a read-only grant is offered (the reviewed tools/list contract)', () => {
    const published = new Set(
      (
        JSON.parse(read('tests/mcp/__contracts__/tools-read-only-readonly.json')) as {
          name: string;
        }[]
      ).map(tool => tool.name)
    );
    const called = [...scenario.matchAll(/\bname: '([a-z_]+)'/g)].map(match => match[1]);
    expect(called.length).toBeGreaterThanOrEqual(4);
    for (const tool of called) expect(published, tool).toContain(tool);
  });

  it('plans only executable reads the seeded grants can perform', () => {
    const operations = [...scenario.matchAll(/operationId: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(operations).toHaveLength(3);
    for (const operationId of operations) {
      const operation = MCP_CATALOG.find(entry => entry.operationId === operationId);
      expect(operation && isMcpExecutable(operation), operationId).toBe(true);
      expect(operation!.method).toBe('get');
      for (const scope of operation!.requiredScopes) expect(MCP_LOAD_SCOPES).toContain(scope);
    }
    for (const scope of MCP_LOAD_SCOPES) {
      expect(supportedMcpScopes()).toContain(scope);
      expect(scope.endsWith(':read'), scope).toBe(true);
    }
  });

  it('covers the 2025-06-18 compatibility path and gates on server errors and busy rate', () => {
    expect(scenario).toContain("const LEGACY = '2025-06-18'");
    expect(scenario).toContain("opsknight_mcp_server_errors_total: ['count==0']");
    expect(scenario).toContain("opsknight_mcp_busy_rate: ['rate<0.01']");
  });

  it('runs from npm and in every topology profile next to the mixed incident storm', () => {
    const scripts = new Map(
      Object.entries(
        (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts
      )
    );
    expect(scripts.get('load:mcp')).toBe('k6 run tests/load/scenarios/mcp-assistants.js');
    expect(scripts.get('load:mcp-mixed')).toBe('node scripts/mcp/mixed-load.cjs');
    const topology = read('tests/load/helpers/topology.ts');
    expect(topology.split("'mcp-assistants.js'").length).toBe(
      topology.split("'mixed-incident-storm.js'").length
    );
  });
});
