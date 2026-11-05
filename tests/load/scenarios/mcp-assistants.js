import { check } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { getActiveLoadLevel, getBaseUrl, getDurationProfile, loadSeedManifest } from './_shared.js';

// OBS-10: AI assistants driving /mcp over HTTP, the way they do in production: per-principal
// grants (seeded by tests/load/helpers/seed.ts, MCP_LOAD_PRINCIPALS), the 2026-07-28 envelope with
// routing headers, and a share of 2025-06-18 stateless clients. Read-only; it changes nothing.
// scripts/mcp/mixed-load.cjs measures executor-level reads only; this goes through the route.
const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();
const MODERN = '2026-07-28';
const LEGACY = '2025-06-18';

const mcpLatency = new Trend('opsknight_mcp_tool_latency_ms', true);
const mcpServerErrors = new Counter('opsknight_mcp_server_errors_total');
const mcpBusy = new Rate('opsknight_mcp_busy_rate');
const mcpSuccess = new Rate('opsknight_mcp_success_rate');

/** Per-tool p95 budgets (ms), tagged by the mcp-name the route routes on. */
const P95_BUDGET_MS = {
  'tools/list': 400,
  search_capabilities: 600,
  incident_search: 800,
  incident_get_context: 1200,
  execute_plan: 1500,
};

export const options = {
  scenarios: {
    mcp_assistants: {
      executor: 'constant-arrival-rate',
      rate: Math.max(2, Math.floor(level.targetRps * 0.2)),
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: Math.max(2, Math.floor(level.vus / 4)),
      maxVUs: Math.max(4, Math.floor(level.maxVUs / 4)),
      exec: 'runMcpAssistant',
    },
  },
  thresholds: {
    opsknight_mcp_server_errors_total: ['count==0'],
    opsknight_mcp_busy_rate: ['rate<0.01'],
    opsknight_mcp_success_rate: ['rate>0.99'],
    ...Object.fromEntries(
      Object.entries(P95_BUDGET_MS).map(([tool, budget]) => [
        `opsknight_mcp_tool_latency_ms{tool:${tool}}`,
        [`p(95)<${budget}`],
      ])
    ),
  },
};

function tokens() {
  const seeded = (manifest.mcp && manifest.mcp.tokens) || [];
  if (seeded.length) return seeded;
  return __ENV.MCP_TOKEN ? [__ENV.MCP_TOKEN] : [];
}

function rpc(token, version, method, params, tool) {
  const modern = version === MODERN;
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': version,
  };
  if (modern) {
    headers['mcp-method'] = method;
    if (params && params.name) headers['mcp-name'] = params.name;
  }
  const body = {
    jsonrpc: '2.0',
    id: __ITER + 1,
    method,
    params: modern
      ? Object.assign({}, params, {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'k6-mcp-assistant', version: '1' },
          },
        })
      : params || {},
  };
  const res = http.post(`${getBaseUrl()}/mcp`, JSON.stringify(body), {
    headers,
    tags: { endpoint: 'mcp', tool, protocol: version },
  });
  mcpLatency.add(res.timings.duration, { tool });
  if (res.status >= 500) mcpServerErrors.add(1, { tool });
  const busy = res.status === 429 || (res.body || '').indexOf('MCP_BUSY') >= 0;
  mcpBusy.add(busy, { tool });
  let ok = false;
  if (res.status === 200) {
    try {
      // JSON, or one SSE frame whose data line carries the same message.
      const dataLine = res.body.split('\n').find(line => line.indexOf('data:') === 0);
      const message = JSON.parse(dataLine ? dataLine.slice(5) : res.body);
      ok = Boolean(message.result) && !(message.result && message.result.isError);
    } catch {
      ok = false;
    }
  }
  mcpSuccess.add(ok, { tool });
  check(res, { [`${tool} answered`]: () => ok });
  return res;
}

export function runMcpAssistant() {
  const pool = tokens();
  if (!pool.length) throw new Error('No MCP tokens: run the load seed or set MCP_TOKEN');
  // One principal per virtual user, as each assistant has its own grant.
  const token = pool[(__VU - 1) % pool.length];
  const incidents = manifest.baselineIncidentIds || [];
  const step = (__VU * 7 + __ITER) % 10;
  if (step === 0) {
    // A 2025-06-18 client on the stateless compatibility path.
    rpc(token, LEGACY, 'tools/list', {}, 'tools/list');
  } else if (step === 1) {
    rpc(token, MODERN, 'tools/list', {}, 'tools/list');
  } else if (step <= 3) {
    rpc(
      token,
      MODERN,
      'tools/call',
      { name: 'search_capabilities', arguments: { query: 'open incidents for a service' } },
      'search_capabilities'
    );
  } else if (step <= 6) {
    rpc(
      token,
      MODERN,
      'tools/call',
      { name: 'incident_search', arguments: { query: { limit: 20 } } },
      'incident_search'
    );
  } else if (step <= 8 && incidents.length) {
    rpc(
      token,
      MODERN,
      'tools/call',
      {
        name: 'incident_get_context',
        arguments: { id: incidents[(__VU + __ITER) % incidents.length] },
      },
      'incident_get_context'
    );
  } else {
    rpc(
      token,
      MODERN,
      'tools/call',
      {
        name: 'execute_plan',
        arguments: {
          steps: [
            { id: 'services', operationId: 'listServices', args: { query: { limit: 10 } } },
            { id: 'incidents', operationId: 'listIncidents', args: { query: { limit: 10 } } },
            { id: 'teams', operationId: 'listTeams', args: { query: { limit: 10 } } },
          ],
        },
      },
      'execute_plan'
    );
  }
}
