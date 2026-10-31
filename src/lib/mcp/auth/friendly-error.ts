import { McpBoundaryError } from '../core/errors';

const MESSAGES = new Map<string, { title: string; body: string }>(
  Object.entries({
    MCP_DISABLED: {
      title: 'AI assistant access is turned off',
      body: 'An OpsKnight administrator needs to enable it in Settings → Integrations & ChatOps → MCP (AI Assistants).',
    },
    MCP_CAPABILITY_DISABLED: {
      title: 'This capability is turned off',
      body: 'An OpsKnight administrator disabled this capability for AI assistants in Settings → Integrations & ChatOps → MCP (AI Assistants) → Exposed capabilities. Do not retry; ask an administrator if you need it.',
    },
    MCP_INVALID_TOKEN: {
      title: 'Sign-in required',
      body: 'Connect OpsKnight again from your assistant to sign in.',
    },
    MCP_CLIENT_METADATA_UNAVAILABLE: {
      title: "We could not load this assistant's details",
      body: 'OpsKnight could not fetch the details this assistant publishes about itself. Try again, and ask an administrator to check outbound network access from the server if it keeps failing.',
    },
    MCP_CLIENT_METADATA_TIMEOUT: {
      title: "We could not load this assistant's details",
      body: 'OpsKnight could not fetch the details this assistant publishes about itself in time. Try again, and ask an administrator to check outbound network access from the server if it keeps failing.',
    },
    MCP_CLIENT_METADATA_TOO_LARGE: {
      title: "This assistant's details are not valid",
      body: 'The details this assistant publishes about itself are larger than OpsKnight accepts. Ask the assistant vendor or an administrator.',
    },
    MCP_CONSENT_EXPIRED: {
      title: 'This sign-in request expired',
      body: 'Return to your assistant and connect again. Requests are valid for five minutes.',
    },
    MCP_CONSENT_NO_SCOPES: {
      title: 'Choose at least one permission',
      body: 'Go back, select what the assistant may do, then choose Allow. To stop connecting, choose Cancel.',
    },
    MCP_CONSENT_REPLAY: {
      title: 'This request was already used',
      body: 'Return to your assistant. If it is not connected, start the connection again.',
    },
    MCP_CLIENT_REVOKED: {
      title: 'This assistant was disconnected',
      body: 'An administrator revoked it. Ask them to allow it again, then reconnect.',
    },
    MCP_RATE_LIMITED: {
      title: 'Too many attempts',
      body: 'Wait a minute, then connect again from your assistant.',
    },
    MCP_INACTIVE_PRINCIPAL: {
      title: 'Your account cannot connect assistants',
      body: 'Your OpsKnight account is inactive or was signed out. Sign in again and retry.',
    },
    invalid_client: {
      title: 'This assistant is not allowed to connect',
      body: 'OpsKnight could not verify this assistant, or an administrator has turned off automatic connections. An administrator can find the exact reason in the server log by searching for client_denied.',
    },
    invalid_request: {
      title: 'The assistant sent an incomplete sign-in request',
      body: 'Return to your assistant and connect again. If it keeps happening, remove OpsKnight from the assistant and add it again.',
    },
    MCP_CLIENT_UNKNOWN: {
      title: 'This connection is out of date',
      body: 'OpsKnight no longer recognises the sign-in details this assistant saved. Remove OpsKnight from your assistant, add it again with the same URL, and sign in.',
    },
    invalid_scope: {
      title: 'The requested access is not available',
      body: 'An administrator limited what assistants may access. Reconnect to get the allowed access.',
    },
    MCP_INVALID_HOST: {
      title: 'Wrong address',
      body: 'Open OpsKnight using the address configured in Settings → System.',
    },
  })
);
const FALLBACK = {
  title: 'We could not connect your assistant',
  body: 'Return to your assistant and try again. If it keeps failing, ask an administrator to run the MCP connection test in Settings.',
};

export function friendlyMcpError(code: string) {
  const message = MESSAGES.get(code);
  return message ? { ...message, known: true } : { ...FALLBACK, known: false };
}

/** OAuth error code a redirected authorization failure should carry back to the assistant. */
export function oauthErrorFor(code: string) {
  switch (code) {
    case 'invalid_scope':
      return 'invalid_scope';
    case 'MCP_RATE_LIMITED':
    case 'MCP_DISABLED':
    case 'MCP_BUSY':
      return 'temporarily_unavailable';
    case 'invalid_client':
    case 'MCP_CLIENT_UNKNOWN':
    case 'MCP_CLIENT_REVOKED':
      return 'unauthorized_client';
    case 'MCP_INACTIVE_PRINCIPAL':
      return 'access_denied';
    case 'invalid_request':
    case 'invalid_target':
    case 'MCP_DUPLICATE_PARAMETER':
      return 'invalid_request';
    default:
      return 'server_error';
  }
}

const escape = (value: string) => value.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

/** Browser-facing HTML for OAuth failures that happen in the user's tab. Never echoes input. */
export function mcpErrorPage(error: unknown) {
  const code = error instanceof McpBoundaryError ? error.code : 'MCP_UNAVAILABLE';
  const status = error instanceof McpBoundaryError ? error.status : 503;
  const { title, body } = friendlyMcpError(code);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)} | OpsKnight</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#14171f}main{max-width:26rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e3e6ec;border-radius:12px}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;color:#4b5262}small{color:#7b8294}@media(prefers-color-scheme:dark){body{background:#0e1117;color:#e8eaf0}main{background:#171b24;border-color:#2a3040}p{color:#a8afbf}}</style></head><body><main role="alert"><h1>${escape(title)}</h1><p>${escape(body)}</p><p><small>Reference: ${escape(code)}</small></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      ...(status === 429 || status === 503 ? { 'Retry-After': '5' } : {}),
    },
  });
}
