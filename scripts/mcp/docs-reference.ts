/**
 * Generated MCP reference pages: troubleshooting (error codes and log events) and permissions
 * (scopes, roles and operation counts). Every list is read from the code; the only hand-written
 * parts are the explanations in MCP_ERROR_GUIDE and MCP_LOG_GUIDE, and tests require those to
 * cover exactly the codes and events the source raises.
 *
 * Write the pages with `npm run mcp:docs`; CI runs `npm run mcp:docs:check` and the
 * tests/mcp/docs-reference.test.ts drift test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP_ROLES } from '../../src/lib/authorization';
import {
  MCP_CATALOG,
  isMcpApprovalGated,
  isMcpExecutable,
  isMcpSensitiveRead,
} from '../../src/lib/mcp/catalog';
import { buildMcpParityReport } from '../../src/lib/mcp/catalog/parity';
import { MCP_REDACTED_FIELDS } from '../../src/lib/mcp/core/projection';
import { DEFAULT_ASSISTANT_SCOPES } from '../../src/lib/mcp/auth/client-policy';
import { buildMcpConsentOffer, isMcpViewScope } from '../../src/lib/mcp/auth/consent-offer';
import { friendlyMcpError } from '../../src/lib/mcp/auth/friendly-error';
import { mcpScopesUsableByRole } from '../../src/lib/mcp/auth/role-scopes';
import { describeMcpScope, supportedMcpScopes } from '../../src/lib/mcp/auth/scopes';
import { McpBoundaryError } from '../../src/lib/mcp/core/errors';
import { toolErrorText } from '../../src/lib/mcp/protocol/server';
import { parse as parseYaml } from 'yaml';
import { OPERATIONAL_METRICS } from '../../src/lib/metrics/operational/registry';
import { MCP_METRIC_OUTCOMES, MCP_TIMED_OUTCOMES } from '../../src/lib/mcp/protocol/metrics';
import {
  MCP_OAUTH_ENDPOINTS,
  MCP_OAUTH_OUTCOMES,
} from '../../src/lib/mcp/auth/oauth-observability';
import { MCP_AUTH_CONCURRENCY, MCP_MAX_OPERATIONS } from '../../src/lib/mcp/core/budget';
import { MCP_TOOLS_PAGE, renderTools } from './docs-tools';

export const MCP_DOCS_ROOT = 'docs/v2.2.0';
/** Date the hand-written explanations below were last checked against the code. */
export const MCP_DOCS_VERIFIED_AT = '2026-11-09';
export const MCP_TROUBLESHOOTING_PAGE = `${MCP_DOCS_ROOT}/guides/mcp/troubleshooting.md`;
export const MCP_PERMISSIONS_PAGE = `${MCP_DOCS_ROOT}/reference/mcp/permissions.md`;
export const MCP_MONITORING_PAGE = `${MCP_DOCS_ROOT}/operate/mcp/monitoring.md`;
export const MCP_ALERT_RULES_FILE = 'monitoring/prometheus/opsknight-alerts.yaml';
/** Listen-stream caps, mirrored from src/lib/mcp/protocol/subscriptions.ts (a test pins them). */
export const MCP_STREAM_LIMITS = { perProcess: 32, perGrant: 2, lifetimeMinutes: 10 };

type Area = 'sign-in' | 'tools' | 'approvals' | 'settings' | 'server';

const AREA_TITLE: Record<Area, string> = {
  'sign-in': 'Connecting and signing in',
  tools: 'Tool calls',
  approvals: 'Reviewed changes',
  settings: 'Settings pages',
  server: 'Server configuration and start-up',
};

type Guide = { area: Area; meaning: string; fix: string };

/** One explanation per MCP_* code the source raises. A new code without an entry fails CI. */
export const MCP_ERROR_GUIDE: Record<string, Guide> = {
  MCP_ACCESS_CHANGED: {
    area: 'sign-in',
    meaning:
      "A security event ended the connection: the person's password or email changed, they were demoted from Administrator, deactivated, signed out everywhere, or an administrator revoked their sessions.",
    fix: 'Reconnect OpsKnight from the assistant. Team and ordinary role changes do not cause this.',
  },
  MCP_ADMIN_REQUIRED: {
    area: 'settings',
    meaning:
      'The settings action needs an administrator (or, for runbook approvals, a runbook approver).',
    fix: 'Ask an administrator.',
  },
  MCP_ALREADY_CONFIGURED: {
    area: 'settings',
    meaning: 'Quick setup was clicked while MCP was already on.',
    fix: 'Reload the page; use Access policy to change settings.',
  },
  MCP_APPROVAL_BACKLOG: {
    area: 'approvals',
    meaning: 'This connection already has 20 configuration changes waiting or approved but unused.',
    fix: 'Review, reject or let the pending requests expire, then prepare again.',
  },
  MCP_APPROVAL_EXPIRED: {
    area: 'approvals',
    meaning:
      'The request was not reviewed within the review window, or was approved but not applied within the commit window.',
    fix: 'Prepare the change again with a new idempotencyKey. Administrators can lengthen both windows under Access policy → Reviewed actions.',
  },
  MCP_APPROVAL_GUARD_NOT_ENFORCED: {
    area: 'server',
    meaning: 'An approved change reached a route that did not run the shared approval check.',
    fix: 'Report it: this is a server defect. Nothing is retried automatically.',
  },
  MCP_APPROVAL_PLAN_CHANGED: {
    area: 'approvals',
    meaning:
      'The reviewed request no longer matches: its digest differs, or for a destructive change the target changed after review.',
    fix: 'Prepare the change again so a reviewer sees the current state.',
  },
  MCP_APPROVAL_REJECTED: {
    area: 'approvals',
    meaning:
      'A reviewer rejected the request. The status tools return their reason, labelled untrusted.',
    fix: 'Read the reason with operation_get_approval or runbook_get_approval; prepare a new request with a new idempotencyKey if appropriate.',
  },
  MCP_APPROVAL_REQUIRED: {
    area: 'approvals',
    meaning: 'The assistant tried to apply a request that is still waiting for review.',
    fix: 'Share the reviewUrl and poll the get_approval tool until it reports APPROVED.',
  },
  MCP_APPROVAL_UNAVAILABLE: {
    area: 'approvals',
    meaning:
      'No such approval for this connection and person (another grant or user cannot see it).',
    fix: 'Use the approval ID returned by the prepare call, from the same connection.',
  },
  MCP_APPROVER_REQUIRED: {
    area: 'approvals',
    meaning: 'The signed-in person cannot approve runbook runs.',
    fix: 'Ask someone with the runbook approve permission (Responders and Administrators by default).',
  },
  MCP_AUTHORITY_CHANGED: {
    area: 'approvals',
    meaning: "The requester's connection or permissions changed after the request was made.",
    fix: 'The requester reconnects if needed and prepares the change again.',
  },
  MCP_AUTHORIZATION_FAILED: {
    area: 'sign-in',
    meaning: 'The consent page could not create the authorization code.',
    fix: 'Start the connection again from the assistant. Check the server log if it repeats.',
  },
  MCP_BODY_TIMEOUT: {
    area: 'tools',
    meaning: 'The request body took longer than five seconds to arrive.',
    fix: 'Retry; check proxy buffering and network health.',
  },
  MCP_BODY_TOO_LARGE: {
    area: 'tools',
    meaning: 'The request body is larger than 64 KiB.',
    fix: 'Send smaller arguments.',
  },
  MCP_BUSY: {
    area: 'tools',
    meaning:
      "The server is at its concurrent-request limit and the request waited too long in the queue (or the queue is full, or the person's connections already hold half the slots between them).",
    fix: 'Retry after the Retry-After interval (1 second). Administrators can raise Concurrent requests per process under Workload limits.',
  },
  MCP_CONTENTION: {
    area: 'tools',
    meaning:
      'Another request changed the same record at the same moment and the database turned this one back after its own retries.',
    fix: 'Read the current state, then try again. Reuse the same idempotencyKey for a change so a replay never applies it twice.',
  },
  MCP_CANCELLED: {
    area: 'tools',
    meaning: 'The client cancelled the request or closed the connection.',
    fix: 'Nothing to fix. A change may still have committed; retry with the same idempotencyKey.',
  },
  MCP_CAPABILITY_DISABLED: {
    area: 'tools',
    meaning:
      'An administrator turned this tool, operation or domain off under Exposed capabilities.',
    fix: 'Do not retry. Ask an administrator if you need it.',
  },
  MCP_CLIENT_METADATA_FORBIDDEN: {
    area: 'sign-in',
    meaning:
      "The assistant's metadata document host resolves to a private, loopback or otherwise non-public address.",
    fix: 'The assistant must publish its metadata document on a public HTTPS host.',
  },
  MCP_CLIENT_METADATA_TIMEOUT: {
    area: 'sign-in',
    meaning: "Fetching the assistant's metadata document took longer than three seconds.",
    fix: 'Retry. Check outbound HTTPS and DNS from the server.',
  },
  MCP_CLIENT_METADATA_TOO_LARGE: {
    area: 'sign-in',
    meaning: "The assistant's metadata document is larger than 5 KiB.",
    fix: 'Contact the assistant vendor.',
  },
  MCP_CLIENT_METADATA_UNAVAILABLE: {
    area: 'sign-in',
    meaning: "The assistant's metadata document could not be fetched.",
    fix: 'Retry. Check outbound HTTPS from the server; search the log for mcp.cimd.fetch_failed.',
  },
  MCP_CLIENT_NOT_FOUND: {
    area: 'settings',
    meaning: 'The assistant to restore does not exist.',
    fix: 'Reload the Assistants tab.',
  },
  MCP_CLIENT_REVOKED: {
    area: 'sign-in',
    meaning: 'An administrator revoked this assistant.',
    fix: 'An administrator restores it on the Assistants tab; everyone then signs in again.',
  },
  MCP_CLIENT_UNKNOWN: {
    area: 'sign-in',
    meaning:
      'The assistant presented a client ID this server does not know (often a stale cached registration).',
    fix: 'Remove OpsKnight from the assistant, add it again with the same URL and sign in.',
  },
  MCP_CONFIGURATION_INVALID: {
    area: 'settings',
    meaning:
      'MCP cannot be turned on while a configuration problem is listed (App URL, migrations, encryption key).',
    fix: 'Fix the problems shown on the Overview tab, then retry.',
  },
  MCP_CONFIRMATION_REQUIRED: {
    area: 'settings',
    meaning: '"Revoke all active connections" was submitted without ticking the confirmation box.',
    fix: 'Tick the box in the dialog, then confirm.',
  },
  MCP_CONSENT_EXPIRED: {
    area: 'sign-in',
    meaning: 'The consent page was opened more than five minutes ago.',
    fix: 'Start the connection again from the assistant.',
  },
  MCP_CONSENT_NO_SCOPES: {
    area: 'sign-in',
    meaning: 'Allow was clicked with every permission unticked.',
    fix: 'Tick at least one permission, or choose Cancel.',
  },
  MCP_CONSENT_REPLAY: {
    area: 'sign-in',
    meaning: 'The consent form was already submitted (for example from another tab).',
    fix: 'Return to the assistant; start again if it is not connected.',
  },
  MCP_CONTENT_TYPE: {
    area: 'tools',
    meaning: 'The POST did not send Content-Type: application/json.',
    fix: 'Use an MCP client or the official SDK.',
  },
  MCP_CYCLIC_PLAN: {
    area: 'tools',
    meaning: 'execute_plan steps depend on each other in a cycle.',
    fix: 'Remove the circular dependsOn.',
  },
  MCP_DCR_REQUIRES_SCOPES: {
    area: 'settings',
    meaning: 'Automatic connections was turned on with no permissions ticked.',
    fix: 'Tick at least one permission under What assistants may do.',
  },
  MCP_DEADLINE_EXCEEDED: {
    area: 'tools',
    meaning: 'The request ran past its ten-second deadline.',
    fix: 'Retry with fewer steps or a smaller query.limit.',
  },
  MCP_DEPENDENCY_FAILED: {
    area: 'tools',
    meaning: 'An execute_plan step was skipped because a step it depends on failed.',
    fix: 'Fix the failed step first.',
  },
  MCP_DEVICE_CODE_EXPIRED: {
    area: 'sign-in',
    meaning:
      'A device sign-in code was entered after its ten minutes ran out, or after it was already approved, denied or used.',
    fix: 'Start the sign-in again on the device to get a new code.',
  },
  MCP_DEVICE_CODE_INVALID: {
    area: 'sign-in',
    meaning:
      'The code entered on /oauth/mcp/device matches no live device sign-in (a typo, or a code another person already entered). Each counts as a wrong code.',
    fix: 'Enter the eight letters shown on the device; case and the dash do not matter.',
  },
  MCP_DEVICE_CODE_LOCKED: {
    area: 'sign-in',
    meaning:
      'Five wrong device codes were entered by this person or from this network address within 15 minutes, so code entry is paused.',
    fix: 'Wait 15 minutes, then enter the code shown on the device. Repeated lockouts can mean someone is guessing codes.',
  },
  MCP_DEVICE_FLOW_DISABLED: {
    area: 'sign-in',
    meaning:
      'Device sign-in (RFC 8628) is off, or MCP is off. The device authorization endpoint answers 404 and metadata does not advertise it.',
    fix: 'An administrator turns on Device sign-in under Access policy (this needs a recent sign-in).',
  },
  MCP_DISABLED: {
    area: 'sign-in',
    meaning:
      'MCP is turned off for this installation, by an administrator or by the MCP_FORCE_DISABLED=true deployment setting.',
    fix: 'An administrator turns it on from the Overview tab. If the settings page says it is disabled by deployment configuration, the operator removes MCP_FORCE_DISABLED and restarts.',
  },
  MCP_FORCE_DISABLED: {
    area: 'settings',
    meaning:
      'MCP was switched on in settings while the deployment sets MCP_FORCE_DISABLED=true, which overrides the stored policy.',
    fix: 'Ask the operator to remove MCP_FORCE_DISABLED from the environment and restart OpsKnight, then turn MCP on again.',
  },
  MCP_DISTINCT_REVIEWER_REQUIRED: {
    area: 'approvals',
    meaning:
      'Someone tried to approve their own request without being an administrator, the request was made with a personal access token (which always needs a second person), or the administrator-set option Require a different reviewer is on.',
    fix: 'Ask a second person with approval rights to review it.',
  },
  MCP_DOMAIN_REJECTED: {
    area: 'tools',
    meaning:
      'OpsKnight refused the operation for a business reason. The error carries a domainCode from the application error registry and, for invalid input, the failing fields.',
    fix: 'Read domainCode and fields in the error text or its `_meta` (`io.opsknight/error`), correct the input and retry.',
  },
  MCP_DUPLICATE_OPERATION: {
    area: 'server',
    meaning: 'Start-up check: two REST operations share an operation ID.',
    fix: 'Build defect; reinstall a released image.',
  },
  MCP_DUPLICATE_OR_UNSAFE_KEY: {
    area: 'tools',
    meaning: 'The JSON body repeats a key or uses a reserved key such as __proto__.',
    fix: 'Send plain JSON with unique keys.',
  },
  MCP_DUPLICATE_PARAMETER: {
    area: 'sign-in',
    meaning:
      'An OAuth parameter was sent twice. Unknown parameters are ignored; duplicates are refused.',
    fix: 'Report it to the assistant vendor; reconnect.',
  },
  MCP_DUPLICATE_STEP: {
    area: 'tools',
    meaning: 'Two execute_plan steps share an id.',
    fix: 'Give every step a unique id.',
  },
  MCP_EMPTY_BODY: {
    area: 'tools',
    meaning: 'The POST had no body.',
    fix: 'Send a JSON-RPC message.',
  },
  MCP_EMPTY_DOMAIN_RESULT: {
    area: 'tools',
    meaning: 'An operation returned no body where one was expected.',
    fix: 'Retry; report it if it repeats.',
  },
  MCP_HASH_SECRET_UNAVAILABLE: {
    area: 'server',
    meaning: 'No active application encryption key is available to derive the credential key.',
    fix: 'Configure the same ENCRYPTION_KEY on every replica and restart.',
  },
  MCP_HTTPS_REQUIRED: {
    area: 'server',
    meaning: 'The App URL is plain HTTP on a host other than localhost.',
    fix: 'Set an HTTPS App URL in Settings → System.',
  },
  MCP_INACTIVE_PRINCIPAL: {
    area: 'sign-in',
    meaning: 'The person is deactivated, has no valid role, or their session changed.',
    fix: 'Sign in again; an administrator reactivates the account if needed.',
  },
  MCP_INVALID_ARGUMENTS: {
    area: 'tools',
    meaning: 'The arguments do not match the operation schema. The hint names the path and rule.',
    fix: 'Call describe_operation and correct the arguments.',
  },
  MCP_INVALID_CAPABILITY: {
    area: 'settings',
    meaning: 'Exposed capabilities was saved with a name that is not a tool, operation or domain.',
    fix: 'Reload the tab and choose from the list.',
  },
  MCP_INVALID_CIMD_HOST: {
    area: 'settings',
    meaning: 'A trusted assistant host is not a plain DNS name.',
    fix: 'Enter one host name per line, without scheme, port or path.',
  },
  MCP_INVALID_DEPENDENCY: {
    area: 'tools',
    meaning: 'An execute_plan step depends on a step id that does not exist.',
    fix: 'Correct dependsOn.',
  },
  MCP_INVALID_ENCODING: {
    area: 'tools',
    meaning: 'The body is not valid UTF-8 JSON.',
    fix: 'Send UTF-8 JSON.',
  },
  MCP_INVALID_GRANT: {
    area: 'sign-in',
    meaning:
      'The connection is no longer usable: revoked, expired, issued for another server address, its assistant was revoked, or policy no longer trusts the assistant.',
    fix: 'Reconnect. On the Connections tab the row shows why (No longer allowed or Blocked by policy).',
  },
  MCP_INVALID_HEADERS: {
    area: 'tools',
    meaning: 'A Tasks request is missing the matching Mcp-Method or Mcp-Protocol-Version header.',
    fix: 'Use a client that supports protocol revision 2026-07-28 for Tasks.',
  },
  MCP_INVALID_HOST: {
    area: 'sign-in',
    meaning: 'The request Host does not match the configured App URL.',
    fix: 'Open OpsKnight on the App URL; make the proxy preserve the public Host header.',
  },
  MCP_INVALID_NAME: {
    area: 'settings',
    meaning: 'A manually registered assistant needs a name.',
    fix: 'Enter a name.',
  },
  MCP_INVALID_BROWSER_ORIGIN: {
    area: 'settings',
    meaning:
      'An Allowed browser origins entry is not an exact origin (scheme, host and optional port), uses plain http off loopback, or the list has more than 10 entries.',
    fix: 'Enter origins such as https://inspector.example.com or http://localhost:6274, one per line.',
  },
  MCP_INVALID_ORIGIN: {
    area: 'sign-in',
    meaning:
      'A browser Origin header does not match the App URL and is not listed under Allowed browser origins, or the App URL itself is invalid.',
    fix: 'Check the App URL in Settings → System. For a browser-hosted client such as MCP Inspector, an administrator adds its exact origin under Allowed browser origins.',
  },
  MCP_INVALID_PAGE_SIZE: {
    area: 'tools',
    meaning: 'query.limit is outside 1 to 50.',
    fix: 'Use a limit from 1 to 50 and follow nextCursor for more.',
  },
  MCP_INVALID_QUERY: {
    area: 'tools',
    meaning: 'A query parameter value is an object or array where a scalar is required.',
    fix: 'Send a string, number or boolean.',
  },
  MCP_INVALID_REDIRECT: {
    area: 'settings',
    meaning:
      'A manual registration redirect URI is not HTTPS, loopback HTTP or a native app scheme (a reverse-DNS scheme, or cursor, vscode, vscode-insiders or windsurf).',
    fix: 'Enter the exact callback the assistant uses.',
  },
  MCP_INVALID_RESOURCE_ID: {
    area: 'tools',
    meaning: 'A resource id or opsknight:// URI is malformed.',
    fix: 'Use an id returned by a list or search.',
  },
  MCP_INSUFFICIENT_SCOPE: {
    area: 'sign-in',
    meaning:
      'Scope step-up is on and the call needs a permission this connection lacks but a new consent could grant. HTTP 403 with an insufficient_scope challenge naming the scopes to ask for.',
    fix: 'A supporting assistant re-opens sign-in for the extra permission; approve it. Others reconnect.',
  },
  MCP_INVALID_SCOPE: {
    area: 'sign-in',
    meaning:
      'No requested permission is allowed, or the connection carries admin:manage, which MCP never honours.',
    fix: 'Reconnect; an administrator checks the scope ceiling.',
  },
  MCP_INVALID_SUBSCRIPTION: {
    area: 'tools',
    meaning: 'subscriptions/listen received more than five URIs or a non-string URI.',
    fix: 'Subscribe to at most five opsknight:// URIs per stream.',
  },
  MCP_INVALID_TOKEN: {
    area: 'sign-in',
    meaning: 'The bearer token is malformed, unknown or expired.',
    fix: 'Let the assistant refresh or reconnect.',
  },
  MCP_TOKEN_REQUIRED: {
    area: 'sign-in',
    meaning:
      'The request to /mcp carried no Authorization header: the assistant has not signed in yet.',
    fix: 'Let the assistant start sign-in from the challenge; this is normal on a first connection.',
  },
  MCP_JSON_DEPTH: {
    area: 'tools',
    meaning: 'The JSON body is nested deeper than 24 levels.',
    fix: 'Flatten the arguments.',
  },
  MCP_LOGIN_REQUIRED: {
    area: 'settings',
    meaning: 'The settings or review page needs a signed-in user.',
    fix: 'Sign in.',
  },
  MCP_NOT_A_CHANGE: {
    area: 'tools',
    meaning: 'call_operation was called with an operation that only reads.',
    fix: 'Use read_operation with the same operationId and args.',
  },
  MCP_NOT_A_READ: {
    area: 'tools',
    meaning: 'read_operation was called with an operation that changes something.',
    fix: 'Use call_operation for routine changes or operation_prepare for reviewed ones.',
  },
  MCP_OPERATION_BUDGET_EXCEEDED: {
    area: 'tools',
    meaning: 'The request uses more operations than Operations per request allows (at most 8).',
    fix: 'Split the work across several calls.',
  },
  MCP_OPERATION_DISABLED: {
    area: 'tools',
    meaning: 'Changes or sensitive reads are turned off in Access policy.',
    fix: 'An administrator turns on reviewed actions or sensitive reads under Access policy → Reviewed actions.',
  },
  MCP_OPERATION_FORBIDDEN: {
    area: 'tools',
    meaning: "The person's OpsKnight role does not allow this operation.",
    fix: 'An administrator changes the role. Reconnecting does not help.',
  },
  MCP_OPERATION_UNAVAILABLE: {
    area: 'tools',
    meaning: 'Unknown operationId, or the operation is not available through this tool.',
    fix: 'Use search_capabilities to find one.',
  },
  MCP_ORIGIN_REQUIRED: {
    area: 'server',
    meaning: 'No App URL is configured.',
    fix: 'Set the App URL in Settings → System.',
  },
  MCP_PLAN_READS_ONLY: {
    area: 'tools',
    meaning: 'execute_plan accepts reads only.',
    fix: 'Run changes one at a time with call_operation.',
  },
  MCP_POLICY_INVALID: {
    area: 'settings',
    meaning:
      'The MCP settings save refused a value; the form shows which one (for example no permission for automatic connections, a bad host or browser origin, or setup not ready).',
    fix: 'Change the value the message names, then save again.',
  },
  MCP_POLICY_CONFLICT: {
    area: 'settings',
    meaning: 'Someone else saved the MCP policy or exposed capabilities after this page loaded.',
    fix: 'Choose Reload policy, re-apply your change and save.',
  },
  MCP_RATE_LIMITED: {
    area: 'sign-in',
    meaning:
      'A rate limit was hit: the connection or person quota on /mcp (HTTP 429 with Retry-After), too many consents (10 a minute), metadata fetches (6 a minute) or review decisions by one person, too many sign-in requests from one network address, or a network address that keeps sending invalid bearer tokens (30 a minute).',
    fix: 'Wait for the Retry-After interval (at most a minute) and retry. For a steady /mcp 429, an administrator raises Weighted operations per minute per grant under Workload limits, or checks the per-person cap.',
  },
  MCP_PAT_DISABLED: {
    area: 'settings',
    meaning:
      'A personal access token was requested while personal access tokens are off in the access policy. Turning them off revokes every token; a revoked token gets MCP_INVALID_GRANT.',
    fix: 'Ask an administrator to allow personal access tokens, then create a new token.',
  },
  MCP_PAT_INVALID_EXPIRY: {
    area: 'settings',
    meaning: 'The chosen expiry is outside 1 day to the policy maximum (at most 90 days).',
    fix: 'Choose one of the offered expiry options.',
  },
  MCP_PAT_LIMIT_REACHED: {
    area: 'settings',
    meaning: 'The person already holds 20 active personal access tokens.',
    fix: 'Revoke a token that is no longer used under Connections, then create the new one.',
  },
  MCP_REAUTHENTICATION_REQUIRED: {
    area: 'approvals',
    meaning:
      'Approving a destructive change, creating a personal access token, or a settings change that gives assistants more access (turning something on, adding a scope, host or origin, raising a limit, allowing personal tokens or lifting view-only connections, re-exposing a capability, adding or restoring an assistant), needs a sign-in within the last two hours. Changes that only reduce access never need it.',
    fix: "Choose Confirm it's you on the page, or Sign in again in settings, then repeat the action.",
  },
  MCP_REGISTRATION_CAPACITY: {
    area: 'sign-in',
    meaning: 'The registry already holds 5,000 automatically registered assistants.',
    fix: 'Retry later. When the registry is full, the oldest registration never used to sign in (and older than an hour) is replaced; unused registrations are also deleted after 30 days.',
  },
  MCP_REGISTRATION_DISABLED: {
    area: 'sign-in',
    meaning: 'Automatic connections are off, so assistants cannot register themselves.',
    fix: 'An administrator turns on Automatic connections under Access policy.',
  },
  MCP_RESOURCE_UNAVAILABLE: {
    area: 'tools',
    meaning: 'Not found, or not visible to this person.',
    fix: 'Check the id with a list or search read.',
  },
  MCP_RESULT_BUDGET_EXCEEDED: {
    area: 'tools',
    meaning: 'The result is larger than 256 KiB.',
    fix: 'Lower query.limit or narrow the filters.',
  },
  MCP_REVIEWER_CHANGED: {
    area: 'approvals',
    meaning: "The reviewer's account or session changed while reviewing.",
    fix: 'Reload the review page and decide again.',
  },
  MCP_REVIEWER_NOT_AUTHORIZED: {
    area: 'approvals',
    meaning:
      'Configuration changes need an active administrator who holds every permission the change needs.',
    fix: 'Ask an administrator to review it.',
  },
  MCP_RUNTIME_NOT_LOADED: {
    area: 'server',
    meaning: 'MCP configuration was used before it loaded.',
    fix: 'Retry; report it if it repeats.',
  },
  MCP_SCHEMA_DEPTH: {
    area: 'server',
    meaning: 'Start-up check: an operation schema nests deeper than 24 levels.',
    fix: 'Build defect; reinstall a released image.',
  },
  MCP_SCHEMA_REFERENCE: {
    area: 'server',
    meaning: 'Start-up check: an operation schema has an unresolvable reference.',
    fix: 'Build defect; reinstall a released image.',
  },
  MCP_SCOPE_NOT_GRANTED: {
    area: 'tools',
    meaning:
      'The role allows the operation, but this connection was not granted the permission it needs. The hint names the missing scopes.',
    fix: 'Reconnect and tick the named permission on the consent page (the administrator ceiling must include it).',
  },
  MCP_SELF_APPROVAL_CONFIRMATION_REQUIRED: {
    area: 'approvals',
    meaning:
      'An administrator approving their own request did not tick the self-approval confirmation.',
    fix: 'Tick the confirmation on the review page and approve again.',
  },
  MCP_SESSIONS_UNSUPPORTED: {
    area: 'tools',
    meaning: 'The client sent an Mcp-Session-Id header. The server is stateless.',
    fix: 'Use a client that does not require sessions, or remove the header.',
  },
  MCP_STALE_REVIEW: {
    area: 'server',
    meaning: 'Start-up check: review.json does not classify every operation.',
    fix: 'Build defect; reinstall a released image.',
  },
  MCP_SUBSCRIPTIONS_BUSY: {
    area: 'tools',
    meaning: 'The process already holds 32 subscription streams.',
    fix: 'Retry later.',
  },
  MCP_SUBSCRIPTIONS_LIMIT: {
    area: 'tools',
    meaning: 'This connection already holds two subscription streams.',
    fix: 'Close a stream first.',
  },
  MCP_TASK_NOT_FOUND: {
    area: 'tools',
    meaning:
      'Unknown task id, or a task that belongs to another connection or has passed its 24-hour retention.',
    fix: 'Use the task id returned by runbook_execute_approved.',
  },
  MCP_UNAVAILABLE: {
    area: 'tools',
    meaning: 'An unexpected server error. The error text ends with a Reference (the request id).',
    fix: 'Retry. Administrators search the log for mcp.tool.unexpected_error with that requestId.',
  },
};

/** Quoted MCP_* strings in src that are not error codes. */
export const MCP_NON_ERROR_CODES: Record<string, string> = {
  MCP_APPROVAL: 'notification entity type',
  MCP_EQUIVALENT: 'parity report disposition',
  MCP_PERSONAL_TOKEN: 'notification entity type',
  MCP_PUBLIC_ORIGIN: 'optional environment override',
};

/** OAuth error codes the sign-in page explains (they reach people, not tools). */
export const MCP_OAUTH_CODES = [
  'invalid_client',
  'invalid_request',
  'invalid_scope',
  'temporarily_unavailable',
] as const;

/** One explanation per mcp.* log event. A new event without an entry fails CI. */
export const MCP_LOG_GUIDE: Record<string, string> = {
  'mcp.authorize.client_denied':
    'Sign-in refused the assistant. `reason`: unknown_client_id, client_revoked, automatic_connections_off and similar, or no_scopes_allowed_for_this_client (the ceiling and role leave nothing).',
  'mcp.authorize.invalid_request':
    'The authorization request failed validation. `fields` lists the parameters (never their values).',
  'mcp.authorize.unexpected_error':
    'An unexpected error on the authorization endpoint. `name` is the error class.',
  'mcp.call_log.write_failed':
    'A batch of activity-log rows could not be written and was dropped (counted in `opsknight_mcp_call_log_dropped_total`). `rows` is the batch size, `errorName` the error class.',
  'mcp.cimd.client_denied':
    'A metadata-document assistant was refused by policy. `reason`: automatic_connections_off, host_not_in_allowlist or no_scopes.',
  'mcp.cimd.client_id_rejected':
    'The client_id is not a canonical HTTPS URL (`reason`: not_canonical_https_url).',
  'mcp.cimd.document_rejected':
    'The metadata document was fetched but refused. `reason` names the check, such as http_status_404 or content_type_not_json.',
  'mcp.cimd.fetch_failed':
    'The metadata document could not be fetched. `reason` is the MCP code (timeout, too large, forbidden address).',
  'mcp.device.client_denied':
    'A device sign-in request was refused for its client. `reason`: unknown_client_id, client_revoked, device_grant_not_registered (the client did not declare, or was not registered for, the device_code grant), metadata_document_clients_unsupported or no_scopes_allowed_for_this_client.',
  'mcp.device.unexpected_error':
    'An unexpected error on the device authorization endpoint. `name` is the error class.',
  'mcp.grant.last_call_failed':
    'Recording the Last call column failed. The tool call itself still succeeded.',
  'mcp.register.unexpected_error':
    'An unexpected error on the client registration endpoint. `name` is the error class.',
  'mcp.request.completed':
    'One line per /mcp request: `requestId`, `grantId`, `clientId`, `method`, `tool` (the bounded metrics label), `outcome`, `durationMs` and, on failure, `errorCode`. Never arguments or results. Every outcome other than served is always written; MCP_LOG_SAMPLE_SERVED (0 to 1, default 1) samples served requests. A stable contract for log pipelines and SIEMs.',
  'mcp.request.unexpected_error':
    'An unexpected error in the /mcp route. Carries `requestId` (also the X-Request-Id header) and `grantId`.',
  'mcp.revoke.unexpected_error':
    'An unexpected error on the token revocation endpoint. `name` is the error class.',
  'mcp.sensitive_read.audit_failed':
    'Writing the audit row for a sensitive read failed; the read itself was still served. `operationId` and `errorName` only.',
  'mcp.subscription.listener_failed': 'A subscription stream failed while delivering a change.',
  'mcp.subscription.poll_failed': 'The subscription change poll failed; the stream retries.',
  'mcp.subscription.access_lost':
    'A listen stream was closed because the person lost access to a subscribed resource, or their role or teams changed. Clients re-read on reconnect.',
  'mcp.token.grace_reissued':
    'A rotated refresh token was replayed inside the grace window and a new token issued (`grantId`, `replacedId`, `revokedSuccessorId`). Occasional lines are lost responses; many for one grant suggest a stolen token racing the real client.',
  'mcp.token.refresh_reuse_revoked':
    'A rotated refresh token was reused outside the grace window; the whole grant was revoked (`grantId`). The audit log has mcp.grant.reuse_detected with the user and client.',
  'mcp.token.transient':
    'A token request hit a passing database problem and was answered temporarily_unavailable. `prismaCode` and `state` only.',
  'mcp.token.unexpected_error':
    'An unexpected error on the token endpoint, answered server_error. `name` and `prismaCode` only; never form values, codes or tokens.',
  'mcp.tool.unexpected_error':
    'A tool failed unexpectedly. Carries requestId, tool, grantId, errorName and prismaCode; never the arguments.',
};

const SOURCE_EXTENSIONS = /\.(ts|tsx)$/;

function sourceFiles(root: string, dir = root): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks the checked-in src tree
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(root, path);
    return SOURCE_EXTENSIONS.test(entry.name) ? [path] : [];
  });
}

function scan(pattern: RegExp, repoRoot: string) {
  const found = new Map<string, Set<string>>();
  for (const file of sourceFiles(join(repoRoot, 'src'))) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked-in source only
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const files = found.get(match[1]) ?? new Set<string>();
      files.add(relative(repoRoot, file));
      found.set(match[1], files);
    }
  }
  return found;
}

/** Every quoted MCP_* string in src, with the files that mention it. */
export function scanMcpCodes(repoRoot = process.cwd()) {
  return scan(/['"`](MCP_[A-Z0-9_]+)['"`]/g, repoRoot);
}

/** Every `logger.<level>('mcp.…'` event in src. */
export function scanMcpLogEvents(repoRoot = process.cwd()) {
  const found = new Map<string, { level: string; files: Set<string> }>();
  for (const [key, files] of scan(
    /logger\.(?:warn|error|info|debug)\(\s*'(mcp\.[a-z_.]+)'/g,
    repoRoot
  )) {
    found.set(key, { level: '', files });
  }
  for (const file of sourceFiles(join(repoRoot, 'src'))) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked-in source only
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/logger\.(warn|error|info|debug)\(\s*'(mcp\.[a-z_.]+)'/g)) {
      const entry = found.get(match[2])!;
      entry.level =
        entry.level && entry.level !== match[1] ? `${entry.level}, ${match[1]}` : match[1];
    }
  }
  return found;
}

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

function frontmatter(fields: {
  title: string;
  description: string;
  type: string;
  audience: string[];
  evidence: string[];
}) {
  return [
    '---',
    `title: ${fields.title}`,
    `description: ${fields.description}`,
    `type: ${fields.type}`,
    'product_area: mcp',
    `audience: [${fields.audience.join(', ')}]`,
    'verification:',
    '  level: source',
    `  verified_at: ${MCP_DOCS_VERIFIED_AT}`,
    '  evidence:',
    ...fields.evidence.map(path => `    - ${path}`),
    '---',
    '',
  ].join('\n');
}

const GENERATED_NOTE =
  '<!-- Generated by `npm run mcp:docs` from scripts/mcp/docs-reference.ts. Do not edit by hand; CI fails when this page drifts from the code. -->';

/** The assistant-facing hint for a code, exactly as tools return it. */
function toolHint(code: string) {
  const text = toolErrorText(new McpBoundaryError(code));
  return text.startsWith(`${code}: `) ? text.slice(code.length + 2) : '';
}

export function renderTroubleshooting(repoRoot = process.cwd()) {
  const codes = [...scanMcpCodes(repoRoot).keys()].filter(code => !(code in MCP_NON_ERROR_CODES));
  const events = scanMcpLogEvents(repoRoot);
  const lines: string[] = [
    frontmatter({
      title: 'MCP troubleshooting',
      description:
        'Every MCP error code and diagnostic log event, what it means and how to fix it.',
      type: 'troubleshooting',
      audience: ['administrator', 'responder', 'operator'],
      evidence: [
        'scripts/mcp/docs-reference.ts',
        'src/lib/mcp/auth/friendly-error.ts',
        'src/lib/mcp/protocol/server.ts',
        'tests/mcp/docs-reference.test.ts',
      ],
    }),
    GENERATED_NOTE,
    '',
    '# MCP troubleshooting',
    '',
    'Start with **Test connection** on the Overview tab of **Settings → Integrations & ChatOps → MCP (AI Assistants)**. It checks the App URL, migrations, sign-in discovery, automatic connections and that anonymous access is refused. For setup steps see [Self-hosted setup](self-hosted-setup.md); for what each permission unlocks see [Permissions](../../reference/mcp/permissions.md).',
    '',
    'Tool errors carry a structured `error` object: `code`, optional `domainCode` (a code from the application error registry), `fields` (which input failed and why), `retryable`, `retryAfterSeconds`, `hint` and `requestId`. The `requestId` is also the `X-Request-Id` response header and appears in server log entries, so support can find the exact request. Problem titles and details from the application are never forwarded.',
    '',
    `This page lists ${codes.length} MCP codes and ${events.size} log events found in the source.`,
    '',
  ];
  for (const area of Object.keys(AREA_TITLE) as Area[]) {
    const rows = codes.filter(code => MCP_ERROR_GUIDE[code]?.area === area);
    if (!rows.length) continue;
    lines.push(
      `## ${AREA_TITLE[area]}`,
      '',
      '| Code | What it means | What to do |',
      '| --- | --- | --- |'
    );
    for (const code of rows) {
      const guide = MCP_ERROR_GUIDE[code];
      // Stable per-code anchor, in the code's own case, for deep links from error pages.
      lines.push(
        `| <a id="${code}"></a>\`${code}\` | ${cell(guide.meaning)} | ${cell(guide.fix)} |`
      );
    }
    lines.push('');
  }
  const people = [...codes, ...MCP_OAUTH_CODES]
    .map(code => ({ code, ...friendlyMcpError(code) }))
    .filter(entry => entry.known);
  lines.push(
    '## Messages people see',
    '',
    'The sign-in, consent and error pages show these titles and explanations, with the code as a reference.',
    '',
    '| Code | Title | Explanation |',
    '| --- | --- | --- |',
    ...people.map(entry => `| \`${entry.code}\` | ${cell(entry.title)} | ${cell(entry.body)} |`),
    '',
    'Any other code shows "We could not connect your assistant" with advice to retry or ask an administrator to run the connection test.',
    ''
  );
  const hinted = codes.map(code => ({ code, hint: toolHint(code) })).filter(entry => entry.hint);
  lines.push(
    '## Hints assistants receive',
    '',
    'When an error has no more specific hint of its own, tools return these fixed corrections.',
    '',
    '| Code | Hint |',
    '| --- | --- |',
    ...hinted.map(entry => `| \`${entry.code}\` | ${cell(entry.hint)} |`),
    ''
  );
  lines.push(
    '## Server log events',
    '',
    'Search the application log for these event names. Entries never contain tokens, secrets or tool arguments.',
    '',
    '| Event | Level | Meaning | Source |',
    '| --- | --- | --- | --- |',
    ...[...events.keys()].sort().map(event => {
      const entry = events.get(event)!;
      return `| <a id="${event}"></a>\`${event}\` | ${entry.level} | ${cell(MCP_LOG_GUIDE[event] ?? '')} | ${[
        ...entry.files,
      ]
        .sort()
        .map(file => `\`${file}\``)
        .join(', ')} |`;
    }),
    ''
  );
  lines.push(
    '## Common symptoms',
    '',
    '- **The assistant says registration is missing:** turn on **Automatic connections** under **Access policy** and save. Restart the assistant if it cached older metadata.',
    '- **401 after connecting:** the assistant refreshes or reconnects. `MCP_ACCESS_CHANGED` means a security event ended the connection; team and ordinary role edits do not.',
    '- **A permission was granted but the tool still fails:** compare the connection\'s usable permissions on the Connections tab ("N of M usable"). The effective set is the grant ∩ the current ceiling ∩ the person\'s role, minus disabled capabilities.',
    '- **503 with `MCP_BUSY`:** the concurrent-request limit was reached; the client retries after the `Retry-After` interval.',
    '- **Works in a browser but not in a cloud assistant:** check that the cloud assistant can reach your host and trusts its TLS certificate.',
    '- **An approval expired:** prepare it again with a new `idempotencyKey`; lengthen the review or commit window under **Access policy → Reviewed actions** if reviewers need more time.',
    ''
  );
  return lines.join('\n');
}

const ROLE_LABEL: Record<(typeof APP_ROLES)[number], string> = {
  ADMIN: 'Admin',
  RESPONDER: 'Responder',
  AUDITOR: 'Auditor',
  USER: 'User',
};

function scopeArea(scope: string) {
  const offer = buildMcpConsentOffer({
    scopes: [scope],
    explicitlyRequested: [scope],
    role: 'ADMIN',
  });
  return offer.groups[0]?.label ?? 'Other';
}

export function renderPermissions() {
  const scopes = [...supportedMcpScopes()].sort();
  const usable = new Map(APP_ROLES.map(role => [role, mcpScopesUsableByRole(role)]));
  const counts = (scope: string) => {
    const operations = MCP_CATALOG.filter(
      operation =>
        (isMcpExecutable(operation) || isMcpApprovalGated(operation)) &&
        operation.requiredScopes.includes(scope)
    );
    return {
      reads: operations.filter(
        operation =>
          isMcpExecutable(operation) && operation.risk === 'R0' && !isMcpSensitiveRead(operation)
      ).length,
      sensitive: operations.filter(operation => isMcpSensitiveRead(operation)).length,
      routine: operations.filter(operation => isMcpExecutable(operation) && operation.risk === 'R1')
        .length,
      reviewed: operations.filter(operation => isMcpApprovalGated(operation)).length,
    };
  };
  const lines: string[] = [
    frontmatter({
      title: 'MCP permissions reference',
      description: 'Every MCP permission (scope), which roles can use it and what it unlocks.',
      type: 'reference',
      audience: ['administrator', 'responder', 'developer'],
      evidence: [
        'scripts/mcp/docs-reference.ts',
        'src/lib/mcp/auth/role-scopes.ts',
        'src/lib/mcp/auth/effective-access.ts',
        'tests/mcp/docs-reference.test.ts',
      ],
    }),
    GENERATED_NOTE,
    '',
    '# MCP permissions reference',
    '',
    'Assistants act as the person who connected them. A permission (OAuth scope) only narrows what that person can already do; it never adds authority.',
    '',
    '## Effective access',
    '',
    'What a connection can do right now is computed on every request:',
    '',
    '```text',
    'effective scopes = scopes the person ticked on the consent page',
    '                 ∩ the administrator ceiling as it is now',
    "                 ∩ what the person's current role and teams allow",
    '                 − capabilities turned off under Exposed capabilities',
    '```',
    '',
    '- The ceiling for automatically connected assistants (registration or metadata document) is the current **What assistants may do** list, not the copy stored when the assistant registered. Lowering it takes effect on the next request; raising it does not widen existing connections.',
    '- A connection gives no access at all while it is revoked or expired, its assistant is revoked, policy no longer trusts the assistant (Automatic connections off, or its host is not in the trusted list), the person is inactive, or a security event happened (`MCP_ACCESS_CHANGED`).',
    '- Role and team changes apply live on the next request without signing anyone out. Demotion from Administrator is a security event and does sign out.',
    '- The Connections tab shows the same computation: "N of M usable", struck-through **No longer allowed** scopes, and a **Blocked by policy** or **No longer allowed** status with the reason.',
    '- `admin:manage` is never offered to an assistant.',
    '',
    `Quick setup and the default ceiling grant: ${DEFAULT_ASSISTANT_SCOPES.map(scope => `\`${scope}\``).join(', ')}.`,
    '',
    '## On the consent page',
    '',
    '- View permissions are pre-selected. Change permissions are pre-selected only when the assistant asked for them by name, or the connection being replaced had them.',
    '- Any permission can be unticked; Allow needs at least one.',
    "- Permissions the person's role can never use are hidden and noted on the page.",
    '',
    '## Why some changes run directly and others wait for approval',
    '',
    'Each change is reviewed once and given a risk tier. The tier, not the tool, decides whether it waits for a person.',
    '',
    '- **Routine incident actions run directly** (acknowledge, resolve, assign, escalate, reopen, unsnooze, add a note, create an incident, add a watcher or tag). They are what a responder does all night; they already require the person to hold the permission; each is recorded in the audit log under the person who connected the assistant; and each can be undone or corrected by another action. Making them wait for a second person would defeat the point of on-call tooling.',
    '- **Everything that can hide, delay or reconfigure waits for approval** (snooze, suppress, unacknowledge, removing a watcher, schedule overrides, status-page announcements, configuration, runbook runs). These can silence a page, change who is paged, or reach customers, so a person reviews the exact, frozen request first.',
    "- **Neither tier widens anyone's access.** A direct action still runs only within the connected person's current role and team scope, and only while an administrator has turned changes on.",
    '- A tier changes only by a documented review: see the catalog page for the tier of every operation.',
    '',
    '## Permissions',
    '',
    'Operation columns count catalog operations that need the permission: plain reads, sensitive reads (only while an administrator allows sensitive reads), routine changes (run directly when changes are allowed) and reviewed changes (need human approval first). Curated tools reuse these operations. A ✓ means the role can use at least one action the permission gates. The consent label is the text the consent page shows; the operation columns are authoritative for whether a change runs directly or waits for review.',
    '',
    `| Permission | Consent label | Area | Kind | ${APP_ROLES.map(role => ROLE_LABEL[role]).join(' | ')} | Reads | Sensitive reads | Routine changes | Reviewed changes |`,
    `| --- | --- | --- | --- | ${APP_ROLES.map(() => ':-:').join(' | ')} | --: | --: | --: | --: |`,
  ];
  for (const scope of scopes) {
    const count = counts(scope);
    lines.push(
      `| \`${scope}\` | ${cell(describeMcpScope(scope))} | ${scopeArea(scope)} | ${isMcpViewScope(scope) ? 'View' : 'Change'} | ${APP_ROLES.map(role => (usable.get(role)!.has(scope) ? '✓' : '')).join(' | ')} | ${count.reads} | ${count.sensitive} | ${count.routine} | ${count.reviewed} |`
    );
  }
  lines.push(
    '',
    '## Who approves reviewed changes',
    '',
    '- **Configuration changes** (`operation_prepare`): an active administrator who holds every permission the change needs.',
    '- **Runbook runs** (`runbook_prepare_execution`): anyone with the runbook approve and runbook read permissions who can see the target incident or service. By default that is Responders and Administrators.',
    '- An administrator may approve their own request after ticking an explicit confirmation; the approval is recorded as self-approved. Anyone else needs a second person, and so does any request made with a personal access token. When an administrator turns on **Require a different reviewer** (Access policy), nobody may approve their own request, whatever their role. The assistant can never approve.',
    ''
  );
  lines.push(...renderCoverage());
  return lines.join('\n');
}

/** How an assistant reaches one operation, or why it cannot (DX-12). */
function reachedBy(entry: ReturnType<typeof buildMcpParityReport>['operations'][number]) {
  const operation = MCP_CATALOG.find(candidate => candidate.operationId === entry.operationId)!;
  switch (entry.disposition) {
    case 'CURATED_TOOL':
      return `\`${operation.tool}\``;
    case 'DISCOVERABLE':
      return operation.method === 'get' || isMcpSensitiveRead(operation)
        ? isMcpSensitiveRead(operation)
          ? '`read_operation` (sensitive reads on)'
          : '`read_operation`'
        : '`call_operation`';
    case 'APPROVAL_REQUIRED':
      return '`operation_prepare`, then approval';
    case 'MCP_EQUIVALENT':
      return (entry.equivalent?.tools ?? []).map(tool => `\`${tool}\``).join(', then ');
    case 'EXCLUDED_WITH_REASON':
      return 'not available: excluded after review';
    default:
      // The real status first: a recorded denial or exclusion is never described as a to-do.
      if (operation.status === 'DENIED_WITH_REASON')
        return 'not available: restricted to native administration (exclusion review pending)';
      if (operation.status === 'UNSUPPORTED_WITH_REASON')
        return 'not available: not exposed, reason recorded in the catalog (exclusion review pending)';
      return `not available: ${entry.nextStep.toLowerCase().replace(/_/g, ' ')}`;
  }
}

/**
 * REST-to-MCP coverage per area, from the same parity report the coverage artifact uses, so an
 * evaluator can see what an assistant can reach without reading the catalog.
 */
function renderCoverage() {
  const report = buildMcpParityReport(MCP_CATALOG);
  const unavailable = (entry: (typeof report.operations)[number]) =>
    entry.disposition === 'EXCLUDED_WITH_REASON' || entry.blocker !== null;
  const domains = [...new Set(report.operations.map(entry => entry.domain))].sort();
  const lines = [
    '## Coverage by area',
    '',
    'Every REST v2 operation by area: how many an assistant can use directly (curated tools, `read_operation` and `call_operation`), how many need approval first (`operation_prepare` or the runbook approval tools) and how many are not available to assistants. Not available means excluded after review or not yet implemented; the catalog explains each.',
    '',
    '| Area | Operations | Direct | With approval | Not available |',
    '| --- | --: | --: | --: | --: |',
  ];
  for (const domain of domains) {
    const entries = report.operations.filter(entry => entry.domain === domain);
    lines.push(
      `| ${domain} | ${entries.length} | ${entries.filter(entry => entry.executableCandidate).length} | ${
        entries.filter(
          entry =>
            entry.disposition === 'APPROVAL_REQUIRED' || entry.disposition === 'MCP_EQUIVALENT'
        ).length
      } | ${entries.filter(unavailable).length} |`
    );
  }
  const total = report.operations;
  lines.push(
    `| **All** | ${total.length} | ${total.filter(entry => entry.executableCandidate).length} | ${
      total.filter(
        entry => entry.disposition === 'APPROVAL_REQUIRED' || entry.disposition === 'MCP_EQUIVALENT'
      ).length
    } | ${total.filter(unavailable).length} |`,
    '',
    '<details>',
    '<summary>Operations by area</summary>',
    ''
  );
  for (const domain of domains) {
    lines.push(`### ${domain}`, '', '| Operation | How an assistant reaches it |', '| --- | --- |');
    for (const entry of report.operations
      .filter(candidate => candidate.domain === domain)
      .sort((a, b) => (a.operationId < b.operationId ? -1 : 1)))
      lines.push(`| \`${entry.operationId}\` | ${reachedBy(entry)} |`);
    lines.push('');
  }
  lines.push('</details>', '');
  return lines;
}

/** What each opsknight_mcp_* series means for an operator. A new MCP metric without one fails CI. */
export const MCP_METRIC_GUIDE: Record<string, { normal: string; action: string }> = {
  opsknight_mcp_requests_total: {
    normal:
      'Mostly `served`; some `tool_error` and `invalid_request` from assistants guessing arguments.',
    action:
      'Alert on `error`/`unavailable` share (OpsKnightMcpServerErrorRateHigh). Group `mcp.request.completed` log lines by `outcome`, `tool` and `grantId` to find the cause.',
  },
  opsknight_mcp_in_flight: {
    normal: 'Below `opsknight_mcp_in_flight_limit` most of the time.',
    action:
      'Pinned at the limit with `opsknight_mcp_queued` above zero: raise the limit or add web replicas.',
  },
  opsknight_mcp_in_flight_limit: {
    normal: 'The policy value **Concurrent requests per process**, identical on every replica.',
    action: 'Cluster capacity is this value times the web replicas.',
  },
  opsknight_mcp_queued: {
    normal: 'Zero, with short spikes during bursts of parallel tool calls.',
    action: 'Never empties for five minutes: OpsKnightMcpQueueSaturated.',
  },
  opsknight_mcp_busy_total: {
    normal: 'Flat. Each increment is one request shed with MCP_BUSY (work or authentication slot).',
    action:
      'Sustained growth: OpsKnightMcpShedding. Raise the limit, add replicas, or find the busy connection.',
  },
  opsknight_mcp_call_log_dropped_total: {
    normal:
      'Zero. Each increment is one activity-log row (the Connections tab drawer) not written because the queue was full or a batch write failed; requests themselves are unaffected.',
    action:
      'Any growth: search the log for mcp.call_log.write_failed and check database health. Audit rows for changes are written separately and are not affected.',
  },
  opsknight_mcp_subscriptions_active: {
    normal: `Open listen streams on this process, at most ${MCP_STREAM_LIMITS.perProcess}.`,
    action: 'At the cap, new streams get MCP_SUBSCRIPTIONS_BUSY (counted as outcome `busy`).',
  },
  opsknight_mcp_request_duration_seconds: {
    normal: 'Only calls that reached domain work are timed, so rejections never hide slow calls.',
    action:
      'p95 above 2.5 s for a tool: OpsKnightMcpP95High. Check the MCP database pool and slow queries.',
  },
  opsknight_mcp_oauth_requests_total: {
    normal: 'Mostly `issued`; `invalid_grant` when assistants retry stale refresh tokens.',
    action:
      'Token `server_error`/`unavailable`: OpsKnightMcpTokenEndpointFailing. A high `invalid_grant` share: OpsKnightMcpInvalidGrantSpike.',
  },
  opsknight_mcp_maintenance_runs_total: {
    normal: 'One `success` per task per scheduler maintenance pass.',
    action:
      'Failures: OpsKnightMcpMaintenanceFailing. No success in 15 minutes: OpsKnightMcpMaintenanceStalled.',
  },
};

/** The `opsknight.mcp` alert group as shipped. */
export function mcpAlertRules(repoRoot = process.cwd()) {
  const document = parseYaml(readFileSync(join(repoRoot, MCP_ALERT_RULES_FILE), 'utf8')) as {
    groups: {
      name: string;
      rules: {
        alert: string;
        for?: string;
        labels?: { severity?: string };
        annotations?: { summary?: string };
      }[];
    }[];
  };
  return document.groups.find(group => group.name === 'opsknight.mcp')?.rules ?? [];
}

export function renderMonitoring(repoRoot = process.cwd()) {
  const metrics = OPERATIONAL_METRICS.filter(metric => metric.name.startsWith('opsknight_mcp_'));
  const alerts = mcpAlertRules(repoRoot);
  const scope = (value: string) =>
    value === 'instance'
      ? 'Per process (gauge)'
      : value === 'counter'
        ? 'Counter (sum across replicas)'
        : value;
  return [
    frontmatter({
      title: 'MCP monitoring and capacity',
      description:
        'Every MCP metric, the shipped alerts, the per-request log line and how MCP capacity scales with replicas.',
      type: 'reference',
      audience: ['operator', 'administrator'],
      evidence: [
        'scripts/mcp/docs-reference.ts',
        'src/lib/metrics/operational/registry.ts',
        'src/lib/mcp/protocol/metrics.ts',
        'src/lib/mcp/core/budget.ts',
        'monitoring/prometheus/opsknight-alerts.yaml',
        'monitoring/prometheus/mcp.test.yml',
      ],
    }),
    GENERATED_NOTE,
    '',
    '# MCP monitoring and capacity',
    '',
    'Tool failures reach assistants as HTTP 200 JSON-RPC results, so the generic HTTP 5xx alert never fires when MCP breaks. Scrape `/api/metrics` and load the `opsknight.mcp` groups from `monitoring/prometheus/opsknight-alerts.yaml` and `opsknight-recording-rules.yaml`; CI runs their promtool unit tests (`monitoring/prometheus/mcp.test.yml`).',
    '',
    '## Metrics',
    '',
    'No metric carries a user, client, grant or incident identifier. `tool` is a bounded label (named tools, `other` for anything else, `none` off tools/call).',
    '',
    '| Metric | Kind | Labels | Scope | Normal | When it is not |',
    '| --- | --- | --- | --- | --- | --- |',
    ...metrics.map(metric => {
      const guide = MCP_METRIC_GUIDE[metric.name];
      return `| \`${metric.name}\` | ${metric.kind} | ${metric.labels.map(label => `\`${label}\``).join(', ') || '—'} | ${scope(metric.scope)} | ${cell(guide?.normal ?? '')} | ${cell(guide?.action ?? '')} |`;
    }),
    '',
    `\`outcome\` on \`opsknight_mcp_requests_total\`: ${MCP_METRIC_OUTCOMES.map(value => `\`${value}\``).join(', ')}. Every HTTP 429 counts as \`rate_limited\`. The duration histogram observes only ${[...MCP_TIMED_OUTCOMES].map(value => `\`${value}\``).join(', ')}.`,
    '',
    `\`opsknight_mcp_oauth_requests_total\`: \`endpoint\` is ${MCP_OAUTH_ENDPOINTS.map(value => `\`${value}\``).join(', ')}; \`outcome\` is ${MCP_OAUTH_OUTCOMES.map(value => `\`${value}\``).join(', ')}, read from the status and error code actually sent (\`issued\` covers any accepted request, including a redirect to sign-in or consent).`,
    '',
    '## Alerts',
    '',
    '| Alert | Severity | For | Summary |',
    '| --- | --- | --- | --- |',
    ...alerts.map(
      rule =>
        `| <a id="${rule.alert}"></a>\`${rule.alert}\` | ${rule.labels?.severity ?? ''} | ${rule.for ?? 'immediately'} | ${cell(rule.annotations?.summary ?? '')} |`
    ),
    '',
    "Each alert's description in the rules file names the log event to search. Thresholds are starting points; tune them to your traffic.",
    '',
    '## Tracing',
    '',
    'Each /mcp request also produces one OpenTelemetry span named `mcp.request`, with the attributes `mcp.request_id`, `mcp.method`, `mcp.tool`, `mcp.outcome` and `mcp.duration_ms`: the same bounded labels as the metrics, never a person, assistant, connection, argument or result. Server failures (`error`, `unavailable`) set the span status to error; refusals the caller caused do not. OpsKnight only calls the OpenTelemetry API, so nothing is recorded or exported until you register a tracer provider in your deployment, and there is no setting to turn on.',
    '',
    '## Dashboard',
    '',
    'Import `monitoring/grafana/opsknight-mcp.json` into Grafana (choose your Prometheus data source when asked). It shows requests by outcome, the server error share, the slowest 5% of calls by tool, work slots and shedding, open listen streams against the cap, dropped request-log rows and OAuth outcomes. Every panel reads a metric listed above; none is labelled by person, assistant or connection. For per-assistant and per-person usage, use the **Usage** tab in the MCP settings, which is built from the request log.',
    '',
    '## Per-request log',
    '',
    'Every /mcp request writes one `mcp.request.completed` line: `requestId` (also the `X-Request-Id` response header, on errors too), `grantId`, `clientId`, `method`, `tool`, `outcome`, `durationMs` and, on failure, `errorCode`. Arguments and results are never logged. Requests refused before the bearer resolves carry no `grantId`. Outcomes other than `served` are always written; set `MCP_LOG_SAMPLE_SERVED` (0 to 1, default 1) to sample served requests. Treat the field names as a stable contract for SIEM pipelines. Admin-gated sensitive reads also write an `mcp.sensitive_read` audit row (operation, grant, path ids, page size and result size; never query values or data). See [troubleshooting](../../guides/mcp/troubleshooting.md#mcp.request.completed) for every MCP log event.',
    '',
    '## Capacity and sizing',
    '',
    'Every MCP limit is enforced per web process. Multiply by the number of web replicas for cluster capacity. These are arithmetic caps, not measured throughput (see [architecture](architecture.md#workload-isolation)).',
    '',
    '| Limit (per process) | Value | Shed as | Watch |',
    '| --- | --- | --- | --- |',
    `| Concurrent bearer authentications | ${MCP_AUTH_CONCURRENCY} | \`MCP_BUSY\`, Retry-After 1 | \`opsknight_mcp_busy_total\` |`,
    '| Work slots | policy **Concurrent requests per process** (1 to 16) | waits up to 750 ms, then `MCP_BUSY` | `opsknight_mcp_in_flight` vs `opsknight_mcp_in_flight_limit` |',
    '| Work-slot queue | twice the work slots | `MCP_BUSY` at once | `opsknight_mcp_queued` |',
    '| Slots one person may hold | half the work slots, rounded up, across all their connections | waits, then `MCP_BUSY` | `mcp.request.completed` with outcome `busy` by `grantId` |',
    `| Listen streams | ${MCP_STREAM_LIMITS.perProcess} (${MCP_STREAM_LIMITS.perGrant} per connection, ${MCP_STREAM_LIMITS.lifetimeMinutes} minutes each) | \`MCP_SUBSCRIPTIONS_BUSY\` / \`MCP_SUBSCRIPTIONS_LIMIT\` | \`opsknight_mcp_subscriptions_active\` |`,
    `| Operations per request | policy **Operations per request**, at most ${MCP_MAX_OPERATIONS} | \`MCP_OPERATION_BUDGET_EXCEEDED\` | tool errors by \`errorCode\` |`,
    '| MCP database pool | 2 connections (maximum 4) | waits on database connections | `/api/health/deep` `mcp.latencyMs` |',
    '',
    "Example: three web replicas with **Concurrent requests per process** set to 4 admit at most 12 MCP requests at once cluster-wide, queue 24 more, and hold up to 96 listen streams; they need 6 to 12 MCP database connections on top of the web pool. `/api/health/deep` reports each process's `inFlight`, `queued`, `authenticating`, `limit`, `queueCap`, `authLimit`, `streams` and `streamsLimit`.",
    '',
    '## Emergency stop',
    '',
    'Set `MCP_FORCE_DISABLED=true` in the environment and restart to turn MCP off for every surface (the /mcp endpoint, sign-in, token refresh, registration and discovery) whatever the stored policy says. The settings page shows **Disabled by deployment configuration** and refuses to turn MCP on; `/api/health/deep` reports `forceDisabled: true`. Remove the variable and restart to restore the saved policy. Connections are not revoked, so they work again afterwards.',
    '',
  ].join('\n');
}

export const MCP_CATALOG_PAGE = `${MCP_DOCS_ROOT}/reference/mcp/catalog.md`;

/** Replaces each `<!-- generated:name -->…<!-- /generated:name -->` block of a hand-written page. */
export function fillGeneratedBlocks(page: string, blocks: ReadonlyMap<string, string>) {
  let result = page;
  for (const [name, text] of blocks) {
    const open = `<!-- generated:${name} -->`;
    const close = `<!-- /generated:${name} -->`;
    const start = result.indexOf(open);
    const end = result.indexOf(close);
    if (start < 0 || end < start) throw new Error(`Missing generated block ${name}`);
    result = `${result.slice(0, start + open.length)}${text}${result.slice(end)}`;
  }
  return result;
}

/** The catalog's operation counts, from the same registry the coverage gate uses (DX-6, DX-12). */
export function renderCatalogCounts() {
  const report = buildMcpParityReport(MCP_CATALOG);
  const executable = MCP_CATALOG.filter(isMcpExecutable);
  const sensitive = executable.filter(isMcpSensitiveRead);
  const ordinary = executable.filter(operation => !isMcpSensitiveRead(operation));
  // A read changes nothing (risk R0), whatever its HTTP method.
  const ordinaryReads = ordinary.filter(operation => operation.risk === 'R0').length;
  const sensitiveGets = sensitive.filter(operation => operation.method === 'get').length;
  return new Map([
    [
      'mcp-counts',
      `The current snapshot has ${MCP_CATALOG.length} classified operations and ${executable.length} generic candidate adapters. ${ordinary.length} are ordinary (${ordinaryReads} reads and ${ordinary.length - ordinaryReads} routine writes). ${sensitive.length} are sensitive reads that are callable only while an administrator enables them (${sensitiveGets} GET reads and ${sensitive.length - sensitiveGets} reviewed side-effect-free POST reads). A further ${report.approvalGatedOperations} operations are callable only through the approval workflow.`,
    ],
    [
      'mcp-unresolved',
      `This snapshot has ${report.pendingOperations.length} unresolved operations.`,
    ],
  ]);
}

export const MCP_SECURITY_PAGE = `${MCP_DOCS_ROOT}/guides/mcp/security-and-data.md`;

/** The two halves of the projection rule: name fragments, and exact names. */
export function redactedFieldRule(rule: RegExp = MCP_REDACTED_FIELDS) {
  const match = /^\(\?:(.+)\)\|\^\(\?:(.+)\)\$$/.exec(rule.source);
  if (!match) throw new Error(`Unexpected redaction rule shape: ${rule.source}`);
  return { contains: match[1].split('|'), exact: match[2].split('|') };
}

/** The security page's generated facts: redacted fields and the server's log events (DX-5). */
export function renderSecurityBlocks() {
  const { contains, exact } = redactedFieldRule();
  const fragment = (value: string) =>
    value.includes('.?')
      ? `\`${value.replace(/\.\?/g, '')}\` (with or without a separator)`
      : `\`${value}\``;
  const events = [...scanMcpLogEvents().keys()].sort();
  return new Map([
    [
      'mcp-redacted-fields',
      `Any field whose name contains ${contains.map(fragment).join(', ')} (in any letter case), and any field named exactly ${exact.map(value => `\`${value}\``).join(', ')}.`,
    ],
    [
      'mcp-log-events',
      `The server writes ${events.length} MCP log events: ${events.map(event => `\`${event}\``).join(', ')}. Each is explained in [troubleshooting](troubleshooting.md#server-log-events).`,
    ],
  ]);
}

/** Every generated page; render may be async (the tool reference asks the server itself). */
export const MCP_GENERATED_PAGES: readonly {
  path: string;
  render: () => string | Promise<string>;
}[] = [
  { path: MCP_TROUBLESHOOTING_PAGE, render: () => renderTroubleshooting() },
  { path: MCP_TOOLS_PAGE, render: () => renderTools(MCP_DOCS_VERIFIED_AT) },
  { path: MCP_PERMISSIONS_PAGE, render: () => renderPermissions() },
  { path: MCP_MONITORING_PAGE, render: () => renderMonitoring() },
  {
    path: MCP_SECURITY_PAGE,
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed docs path
    render: () =>
      fillGeneratedBlocks(readFileSync(MCP_SECURITY_PAGE, 'utf8'), renderSecurityBlocks()),
  },
  {
    path: MCP_CATALOG_PAGE,
    // Hand-written prose with generated counts: only the marked blocks are rewritten.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed docs path
    render: () =>
      fillGeneratedBlocks(readFileSync(MCP_CATALOG_PAGE, 'utf8'), renderCatalogCounts()),
  },
];
