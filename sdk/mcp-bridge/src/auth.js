// Credentials for the bridge: a personal access token from the environment, or a refresh token
// from `opsknight-mcp login` (OAuth device authorization, RFC 8628) kept in a 0600 file.
// Tokens never reach stdout, stderr or error messages.
/* eslint-disable security/detect-non-literal-fs-filename -- the only path is configPath() */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const USER_AGENT = 'opsknight-mcp-bridge/0.1.0';

export class BridgeError extends Error {}

/** `https://…` anywhere; plain `http://` only to this machine. Returns the base without a trailing `/` or `/mcp`. */
export function serverBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BridgeError(`Not a URL: ${raw}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new BridgeError(
      `Refusing ${url.protocol}//${url.host}: use https:// (plain http is allowed only for localhost and 127.0.0.1).`
    );
  if (url.username || url.password || url.search || url.hash)
    throw new BridgeError('The URL must not contain credentials, a query or a fragment.');
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '').replace(/\/mcp$/, '');
}

export function configPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opsknight', 'mcp.json');
}

export function readConfig(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed?.servers) ? parsed : { servers: [] };
  } catch {
    return { servers: [] };
  }
}

/** The saved sign-in for one server, as { url, clientId, tokenEndpoint, refreshToken }. */
export const savedServer = (config, base) => config.servers.find(entry => entry?.url === base);

function saveServer(path, entry) {
  const config = readConfig(path);
  config.servers = [...config.servers.filter(saved => saved?.url !== entry.url), entry];
  writeConfig(path, config);
}

/** Atomic write, owner-only from the first byte (the temp file is created 0600). */
export function writeConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

async function postForm(endpoint, fields) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
    body: new URLSearchParams(fields),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body && typeof body === 'object' ? body : {} };
}

/** A metadata endpoint must stay on the server the person named, so no token is sent elsewhere. */
function sameServer(base, endpoint, name) {
  if (typeof endpoint !== 'string') throw new BridgeError(`The server does not advertise ${name}.`);
  if (new URL(endpoint).origin !== new URL(base).origin)
    throw new BridgeError(`The server's ${name} is on another origin; refusing it.`);
  return endpoint;
}

/** PAT from the environment: nothing to refresh. */
export function patAuth(token) {
  return { token: async () => token, refresh: async () => false };
}

/**
 * OAuth credentials from the config file. Access tokens live only in memory and are refreshed
 * shortly before expiry, after a 401, and one refresh at a time (refresh tokens rotate).
 */
export function oauthAuth(base, path, log) {
  let access = null;
  let expiresAt = 0;
  let pending = null;
  const refresh = () =>
    (pending ??= (async () => {
      // Another bridge process may have rotated the refresh token since this one loaded it.
      const entry = savedServer(readConfig(path), base);
      if (!entry?.refreshToken) {
        log(`Not signed in to ${base}. Run: opsknight-mcp login --url ${base}`);
        return false;
      }
      const { status, body } = await postForm(entry.tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: entry.refreshToken,
        client_id: entry.clientId,
        resource: `${base}/mcp`,
      }).catch(() => ({ status: 0, body: {} }));
      if (status !== 200 || typeof body.access_token !== 'string') {
        log(
          status === 0
            ? `Could not reach ${base} to refresh the sign-in.`
            : `Refreshing the sign-in failed (${body.error ?? `HTTP ${status}`}). Run: opsknight-mcp login --url ${base}`
        );
        return false;
      }
      access = body.access_token;
      expiresAt = Date.now() + Math.max(30, Number(body.expires_in) || 300) * 1000 - 30_000;
      if (typeof body.refresh_token === 'string') {
        saveServer(path, { ...entry, refreshToken: body.refresh_token });
      }
      return true;
    })().finally(() => {
      pending = null;
    }));
  return {
    async token() {
      if (!access || Date.now() >= expiresAt) await refresh();
      return access;
    },
    refresh,
  };
}

/** `opsknight-mcp login`: device sign-in, then store the refresh token for this server. */
export async function login({ base, scope, clientId, path, log }) {
  /** @type {Record<string, any>} */
  const meta = await fetch(`${base}/.well-known/oauth-authorization-server/oauth/mcp`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  }).then(
    response => (response.ok ? response.json() : {}),
    () => {
      throw new BridgeError(`Could not reach ${base}.`);
    }
  );
  if (!meta.device_authorization_endpoint)
    throw new BridgeError(
      'Device sign-in is turned off on this server. Ask an administrator to turn on Device sign-in, or set OPSKNIGHT_TOKEN to a personal access token.'
    );
  const deviceEndpoint = sameServer(base, meta.device_authorization_endpoint, 'device endpoint');
  const tokenEndpoint = sameServer(base, meta.token_endpoint, 'token endpoint');
  let client = clientId ?? savedServer(readConfig(path), base)?.clientId;
  if (!client) {
    const registration = sameServer(base, meta.registration_endpoint, 'registration endpoint');
    const response = await fetch(registration, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({
        client_name: 'OpsKnight stdio bridge',
        grant_types: [DEVICE_GRANT, 'refresh_token'],
        ...(scope ? { scope } : {}),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== 201 || typeof body.client_id !== 'string')
      throw new BridgeError(
        `Registration failed (HTTP ${response.status}). Ask an administrator to turn on Automatic connections, or pass --client-id.`
      );
    client = body.client_id;
  }
  const start = await postForm(deviceEndpoint, {
    client_id: client,
    resource: `${base}/mcp`,
    ...(scope ? { scope } : {}),
  });
  if (start.status !== 200 || typeof start.body.device_code !== 'string')
    throw new BridgeError(
      `Starting device sign-in failed (${start.body.error ?? `HTTP ${start.status}`}).`
    );
  const { device_code: deviceCode, user_code: userCode } = start.body;
  log(
    `To connect, open ${start.body.verification_uri_complete ?? start.body.verification_uri} and confirm the code ${userCode}.`
  );
  let interval = Number(start.body.interval ?? 5);
  const deadline = Date.now() + Number(start.body.expires_in ?? 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    const { status, body } = await postForm(tokenEndpoint, {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
      client_id: client,
    });
    if (status === 200 && typeof body.refresh_token === 'string') {
      saveServer(path, {
        url: base,
        clientId: client,
        tokenEndpoint,
        refreshToken: body.refresh_token,
      });
      log(`Signed in. Credentials saved to ${path}.`);
      return;
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      interval = Number(body.interval ?? interval + 5);
      continue;
    }
    throw new BridgeError(`Sign-in ended: ${body.error ?? `HTTP ${status}`}.`);
  }
  throw new BridgeError('Sign-in expired. Run login again.');
}
