import { createHash } from 'node:crypto';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { APP_VERSION } from '@/lib/version';
import { loadMcpRuntime, mcpOrigin, mcpResource } from '../auth/config';
import { loadDiscoveryPolicy } from '../auth/discovery-policy';
import { PUBLIC_METADATA_CORS } from '../auth/cors';
import { mcpPolicyInForce } from '../core/kill-switch';
import { withMcpDatabase } from '@/lib/database-workload';
import { MCP_PROTOCOL_REVISION } from './revision';

/**
 * MCP Server Card (SEP-2127, experimental-ext-server-card docs/discovery.md): public, static
 * metadata for pre-connection discovery, served at `<streamable-http-url>/server-card` and linked
 * from `/.well-known/ai-catalog.json`. Advisory only; clients verify it against server/discover.
 */
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
const SERVER_CARD_SCHEMA =
  'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
const CARD_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

const CARD_CORS = { ...PUBLIC_METADATA_CORS, 'Access-Control-Expose-Headers': 'ETag' };

/** This installation's origin while MCP is in force and configured; otherwise null (404). */
async function servedOrigin(): Promise<string | null> {
  return withMcpDatabase(async () => {
    try {
      await loadMcpRuntime();
      if (!mcpPolicyInForce(await loadDiscoveryPolicy())) return null;
      return mcpOrigin();
    } catch {
      return null;
    }
  });
}

/** Reverse-DNS name from the installation's host, e.g. ops.acme.com -> com.acme.ops/opsknight. */
function cardName(origin: string) {
  const name = `${new URL(origin).hostname.split('.').reverse().join('.')}/opsknight`;
  return CARD_NAME.test(name) ? name : 'opsknight/opsknight';
}

export function buildServerCard(origin: string) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: cardName(origin),
    version: APP_VERSION,
    title: 'OpsKnight',
    description:
      'Incidents, services, on-call schedules, runbooks and postmortems from this OpsKnight.',
    icons: [
      { src: `${origin}/icons/opsknight-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
    ],
    remotes: [
      {
        type: 'streamable-http',
        url: mcpResource(),
        // The native revision plus the 2025 revisions served in full; 2025-03-26 is best-effort.
        supportedProtocolVersions: [
          MCP_PROTOCOL_REVISION,
          ...SUPPORTED_PROTOCOL_VERSIONS.filter(version => version >= '2025-06-18'),
        ],
      },
    ],
    // Sign-in is OAuth; the card has no auth field, so the metadata URL rides in namespaced _meta.
    _meta: {
      'com.opsknight/oauthProtectedResourceMetadata': `${origin}/.well-known/oauth-protected-resource/mcp`,
    },
  };
}

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', ...PUBLIC_METADATA_CORS },
  });
}

/** Serves a public document with an ETag, answering a matching If-None-Match with 304. */
function publicDocument(request: Request, body: string, contentType: string) {
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  const headers = { 'Cache-Control': 'public, max-age=3600', ETag: etag, ...CARD_CORS };
  const match = request.headers.get('if-none-match');
  if (match && match.split(',').some(tag => tag.trim() === etag))
    return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'Content-Type': contentType } });
}

export async function serverCardResponse(request: Request) {
  const origin = await servedOrigin();
  if (!origin) return notFound();
  return publicDocument(request, JSON.stringify(buildServerCard(origin)), SERVER_CARD_MEDIA_TYPE);
}

export async function aiCatalogResponse(request: Request) {
  const origin = await servedOrigin();
  if (!origin) return notFound();
  const host = new URL(origin).hostname;
  const catalog = {
    specVersion: '1.0',
    entries: [
      {
        identifier: `urn:air:${host}:mcp:opsknight`,
        type: SERVER_CARD_MEDIA_TYPE,
        url: `${mcpResource()}/server-card`,
      },
    ],
  };
  return publicDocument(request, JSON.stringify(catalog), 'application/ai-catalog+json');
}

export function serverCardPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...PUBLIC_METADATA_CORS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Max-Age': '600',
    },
  });
}
