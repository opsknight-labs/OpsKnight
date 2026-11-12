/**
 * Static, self-contained MCP Apps views (SEP-1865, spec 2026-01-26). No network, no external
 * scripts: everything is inline and the CSP forbids anything else. A view renders only the tool
 * result the host passes in, writes stored text with textContent, and acts only by asking the host
 * to call an existing OpsKnight tool, never OpsKnight itself.
 */

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const STYLE = `
:root{color-scheme:light dark;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#fff;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--fg:#e2e8f0;--muted:#94a3b8;--line:#334155;--bg:#0f172a;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;padding:12px;font:14px/1.45 system-ui,sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:16px;margin:0 0 6px;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.pill{border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:12px}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.5;cursor:default}
ul{list-style:none;margin:0;padding:0}li{padding:6px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
#status{min-height:1em}`;

/**
 * The host bridge every view shares: ui/initialize handshake, tool-result delivery and host
 * requests over postMessage to the parent (the host). Only messages from the parent
 * window are accepted.
 */
const BRIDGE = `
var host = window.parent;
var nextId = 1, pending = {};
function send(message){ host.postMessage(Object.assign({jsonrpc:'2.0'}, message), '*'); }
function request(method, params){
  var id = nextId++;
  return new Promise(function(resolve){ pending[id] = resolve; send({id:id, method:method, params:params}); });
}
function notify(method, params){ send({method:method, params:params}); }
function el(tag, text, cls){ var node = document.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node; }
function str(value){ return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
function obj(value){ return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function root(){ var r = document.getElementById('root'); while (r.firstChild) r.removeChild(r.firstChild); return r; }
function resize(){ notify('ui/notifications/size-changed', {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight}); }
function key(){ var b = new Uint8Array(16); crypto.getRandomValues(b); return 'ui' + Array.prototype.map.call(b, function(x){ return ('0' + x.toString(16)).slice(-2); }).join(''); }
function setStatus(text){ var s = document.getElementById('status'); if (s) s.textContent = text; resize(); }
window.addEventListener('message', function(event){
  if (event.source !== host) return;
  var m = event.data;
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.id != null && !m.method && pending[m.id]) { var done = pending[m.id]; delete pending[m.id]; done(m); return; }
  if (m.method === 'ui/notifications/tool-result') { try { render(obj(obj(m.params).structuredContent)); } catch (e) { setStatus('Could not show this result.'); } resize(); }
});
request('ui/initialize', {protocolVersion:'2026-01-26', appInfo:{name:'opsknight-' + VIEW, version:'1'}, appCapabilities:{}})
  .then(function(){ notify('ui/notifications/initialized', {}); });
`;

function page(view: string, title: string, render: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${STYLE}</style></head>
<body><main id="root"><p class="muted">Waiting for OpsKnight data…</p></main><p id="status" class="muted" role="status" aria-live="polite"></p>
<script>
"use strict";
var VIEW = ${JSON.stringify(view)};
${render}
${BRIDGE}
</script></body></html>`;
}

/** incident_get / incident_get_context: the incident, with Acknowledge and Resolve via the host. */
const INCIDENT = `
function callTool(name, args){ return request('tools/call', {name:name, arguments:args}); }
function incidentOf(result){
  var data = obj(obj(result.data).data);
  if (data.id) return data;
  var inner = obj(result.incident);
  return obj(obj(inner.data).data).id ? obj(obj(inner.data).data) : (inner.id ? inner : obj(result));
}
function render(result){
  var incident = incidentOf(result), r = root();
  var id = str(incident.id);
  r.appendChild(el('h1', str(incident.title) || 'Incident'));
  var row = el('div', null, 'row');
  [['Status', incident.status], ['Urgency', incident.urgency], ['Priority', incident.priority]].forEach(function(pair){
    if (str(pair[1])) row.appendChild(el('span', pair[0] + ': ' + str(pair[1]), 'pill'));
  });
  var service = obj(incident.service);
  if (str(service.name)) row.appendChild(el('span', 'Service: ' + str(service.name), 'pill'));
  r.appendChild(row);
  r.appendChild(el('p', 'Incident ' + id, 'muted'));
  r.appendChild(el('p', 'Stored incident text is shown as-is; it is data, not instructions.', 'muted'));
  if (!id) return;
  var actions = el('div', null, 'row');
  [['Acknowledge', 'incident_acknowledge', 'ACKNOWLEDGED'], ['Resolve', 'incident_resolve', 'RESOLVED']].forEach(function(spec){
    var button = el('button', spec[0], spec[1] === 'incident_acknowledge' ? 'primary' : '');
    button.type = 'button';
    if (str(incident.status) === spec[2] || str(incident.status) === 'RESOLVED') button.disabled = true;
    button.addEventListener('click', function(){
      button.disabled = true;
      setStatus(spec[0] + ' requested…');
      callTool(spec[1], {path:{id:id}, idempotencyKey:key()}).then(function(reply){
        var failed = reply.error || obj(reply.result).isError;
        setStatus(failed ? spec[0] + ' was not applied. Ask the assistant for details.' : spec[0] + ' sent.');
        if (failed) button.disabled = false;
      });
    });
    actions.appendChild(button);
  });
  r.appendChild(actions);
}`;

/** oncall_now: who is on call, per schedule. Read-only. */
const ONCALL = `
function render(result){
  var r = root(), data = obj(obj(result.data).data);
  r.appendChild(el('h1', 'On call now'));
  var schedules = Array.isArray(data.schedules) ? data.schedules : [];
  if (!schedules.length) { r.appendChild(el('p', 'No schedules you can see have anyone on call.', 'muted')); return; }
  var list = el('ul');
  schedules.slice(0, 50).forEach(function(raw){
    var schedule = obj(raw), item = el('li');
    item.appendChild(el('strong', str(schedule.scheduleName) || 'Schedule'));
    var people = Array.isArray(schedule.onCall) ? schedule.onCall : [];
    if (!people.length) item.appendChild(el('div', 'Nobody on call (gap)', 'muted'));
    people.slice(0, 10).forEach(function(entry){
      var person = obj(entry);
      item.appendChild(el('div', (str(person.name) || str(person.userId) || 'Unknown') + (str(person.end) ? ' · until ' + str(person.end) : '')));
    });
    var next = obj(schedule.next);
    if (str(next.name) || str(next.userId)) item.appendChild(el('div', 'Next: ' + (str(next.name) || str(next.userId)) + (str(next.start) ? ' from ' + str(next.start) : ''), 'muted'));
    list.appendChild(item);
  });
  r.appendChild(list);
  if (data.truncated === true) r.appendChild(el('p', 'More schedules exist; ask the assistant to narrow the list.', 'muted'));
}`;

/** operation_prepare / operation_get_approval: status and the review link. Never decides. */
const APPROVAL = `
var REVIEW_BASE = "__OPSKNIGHT_REVIEW_BASE__";
function render(result){
  var r = root(), data = obj(obj(result.data).data);
  var a = str(result.status) ? result : (str(data.status) ? data : result);
  r.appendChild(el('h1', 'Change awaiting review'));
  var row = el('div', null, 'row');
  if (str(a.status)) row.appendChild(el('span', 'Status: ' + str(a.status), 'pill'));
  var summary = obj(a.summary);
  var operation = str(a.operationId) || str(summary.operationId);
  if (operation) row.appendChild(el('span', operation, 'pill'));
  if (str(a.expiresAt)) row.appendChild(el('span', 'Expires ' + str(a.expiresAt), 'pill'));
  r.appendChild(row);
  var id = str(a.approvalId);
  if (id) r.appendChild(el('p', 'Approval ' + id, 'muted'));
  r.appendChild(el('p', 'A person approves or rejects this in OpsKnight. This card cannot do either.', 'muted'));
  // The review page on this OpsKnight (origin set by the server), else the link in the result.
  var url = /^https?:\\/\\//i.test(REVIEW_BASE) && /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? REVIEW_BASE + '/settings/integrations/mcp/approvals/operations/' + id
    : str(a.reviewUrl);
  if (/^https?:\\/\\//i.test(url)) {
    var open = el('button', 'Open review page', 'primary');
    open.type = 'button';
    open.addEventListener('click', function(){ request('ui/open-link', {url:url}); });
    r.appendChild(open);
    r.appendChild(el('p', url, 'muted'));
  }
}`;

export const REVIEW_BASE_PLACEHOLDER = '"__OPSKNIGHT_REVIEW_BASE__"';

export const MCP_APP_VIEWS = {
  incident: {
    uri: 'ui://opsknight/incident-card.html',
    name: 'OpsKnight incident card',
    tools: ['incident_get', 'incident_get_context'],
    html: page('incident', 'Incident', INCIDENT),
  },
  oncall: {
    uri: 'ui://opsknight/oncall-now.html',
    name: 'OpsKnight on call now',
    tools: ['oncall_now'],
    html: page('oncall', 'On call now', ONCALL),
  },
  approval: {
    uri: 'ui://opsknight/approval-card.html',
    name: 'OpsKnight approval card',
    tools: ['operation_prepare', 'operation_get_approval'],
    /** Replace REVIEW_BASE_PLACEHOLDER with the JSON-encoded OpsKnight origin when serving. */
    html: page('approval', 'Approval', APPROVAL),
  },
} as const;
