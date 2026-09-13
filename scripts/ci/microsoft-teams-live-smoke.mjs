import trustedServiceHosts from '../../src/lib/microsoft-teams/trusted-service-hosts.json' with { type: 'json' };

const required = ['TEAMS_E2E_TENANT_ID', 'TEAMS_E2E_CLIENT_ID', 'TEAMS_E2E_CLIENT_SECRET', 'TEAMS_E2E_TEAM_ID', 'TEAMS_E2E_CHANNEL_ID', 'TEAMS_E2E_SERVICE_URL'];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.log(`Live Microsoft Teams smoke skipped: missing ${missing.join(', ')}`);
  process.exit(0);
}

const env = Object.fromEntries(required.map(name => [name, process.env[name].trim()]));
const serviceUrl = new URL(env.TEAMS_E2E_SERVICE_URL);
if (serviceUrl.protocol !== 'https:' || serviceUrl.username || serviceUrl.password || serviceUrl.port || serviceUrl.search || serviceUrl.hash || !trustedServiceHosts.includes(serviceUrl.hostname.toLowerCase())) {
  throw new Error('TEAMS_E2E_SERVICE_URL is not a trusted Bot Framework host');
}

async function token(scope) {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.TEAMS_E2E_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.TEAMS_E2E_CLIENT_ID, client_secret: env.TEAMS_E2E_CLIENT_SECRET, grant_type: 'client_credentials', scope }),
  });
  if (!response.ok) throw new Error(`Token request failed: HTTP ${response.status}`);
  return (await response.json()).access_token;
}

const graphToken = await token('https://graph.microsoft.com/.default');
const discovery = await fetch(`https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(env.TEAMS_E2E_TEAM_ID)}/channels/${encodeURIComponent(env.TEAMS_E2E_CHANNEL_ID)}?$select=id,displayName`, {
  signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${graphToken}` },
});
if (!discovery.ok) throw new Error(`Channel discovery failed: HTTP ${discovery.status}`);

const botToken = await token('https://api.botframework.com/.default');
const marker = `OpsKnight CI ${new Date().toISOString()}`;
const activity = text => ({
  type: 'message',
  attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
    type: 'AdaptiveCard', version: '1.5', body: [{ type: 'TextBlock', text, wrap: true }],
    ...(process.env.TEAMS_E2E_INCIDENT_ID && process.env.TEAMS_E2E_DESTINATION_ID ? { actions: [{
      type: 'Action.Execute', title: 'Verify Interactive Action', verb: 'opsknight.incident.refresh',
      data: { v: 2, incidentId: process.env.TEAMS_E2E_INCIDENT_ID, destinationId: process.env.TEAMS_E2E_DESTINATION_ID, messageGeneration: Number(process.env.TEAMS_E2E_MESSAGE_GENERATION || '1') },
    }] } : {}),
  } }],
  channelData: { tenant: { id: env.TEAMS_E2E_TENANT_ID } },
});
const create = await fetch(`${serviceUrl.toString().replace(/\/+$/, '')}/v3/conversations`, {
  method: 'POST', signal: AbortSignal.timeout(30_000),
  headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    isGroup: true,
    bot: { id: env.TEAMS_E2E_CLIENT_ID },
    channelData: { channel: { id: env.TEAMS_E2E_CHANNEL_ID }, team: { id: env.TEAMS_E2E_TEAM_ID }, tenant: { id: env.TEAMS_E2E_TENANT_ID } },
    activity: activity(`${marker} — triggered`),
  }),
});
if (!create.ok) throw new Error(`Bot create failed: HTTP ${create.status}`);
const created = await create.json();
if (!created.id || !created.activityId) throw new Error('Bot create did not return conversation and activity IDs');

const update = await fetch(`${serviceUrl.toString().replace(/\/+$/, '')}/v3/conversations/${encodeURIComponent(created.id)}/activities/${encodeURIComponent(created.activityId)}`, {
  method: 'PUT', signal: AbortSignal.timeout(30_000),
  headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ ...activity(`${marker} — resolved`), id: created.activityId }),
});
if (!update.ok) throw new Error(`Bot update failed: HTTP ${update.status}`);
console.log(`Live Microsoft Teams smoke passed: discovery, create, and update succeeded.${process.env.TEAMS_E2E_INCIDENT_ID ? ' Interactive verification card posted for a human client click.' : ''}`);
