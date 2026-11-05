/**
 * CERT-09: checks the client metadata documents real assistants publish against the fixtures the
 * unit suite tests with. Network access, so it runs from its own scheduled workflow
 * (.github/workflows/mcp-cimd-drift.yml), never from the hermetic certification workflow.
 *
 * Exit code 1 only when a live document would be rejected by this server (sign-in would fail for
 * that assistant). A document that is accepted but differs from its fixture, or a network error
 * after retries, is a warning: the job must not be flaky.
 *
 *   npm run mcp:cimd-check [-- --summary <file.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCimdDocument } from '@/lib/mcp/auth/cimd';
import { fetchPinnedMetadata, type CimdResponse } from '@/lib/mcp/auth/cimd-transport';
import { McpBoundaryError } from '@/lib/mcp/core/errors';

/** Only clients confirmed to publish a metadata document. Add others once that is confirmed. */
export const CIMD_LIVE_CLIENTS = [
  { name: 'Claude', fixture: 'tests/mcp/fixtures/cimd/claude.json' },
];

/** The fields a sign-in depends on; display fields may change freely. */
const COMPARED = ['grant_types', 'redirect_uris', 'token_endpoint_auth_method'] as const;

export type CimdCheck =
  | { name: string; clientId: string; status: 'match' }
  | { name: string; clientId: string; status: 'drift'; fields: string[] }
  | { name: string; clientId: string; status: 'rejected'; reason: string }
  | { name: string; clientId: string; status: 'unreachable'; reason: string };

const sorted = (value: unknown) =>
  JSON.stringify(Array.isArray(value) ? [...(value as unknown[])].map(String).sort() : value);

/** Compares one live response with its fixture. Pure apart from the injected fetch. */
export async function checkCimdClient(
  client: { name: string; fixture: Record<string, unknown> },
  fetchDocument: (url: URL) => Promise<CimdResponse>,
  options: { attempts?: number; backoffMs?: number } = {}
): Promise<CimdCheck> {
  const clientId = String(client.fixture.client_id);
  const attempts = options.attempts ?? 3;
  let response: CimdResponse | undefined;
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= attempts && !response; attempt++) {
    try {
      response = await fetchDocument(new URL(clientId));
    } catch (error) {
      lastError = error instanceof McpBoundaryError ? error.code : String(error);
      if (attempt < attempts)
        await new Promise(resolve => setTimeout(resolve, (options.backoffMs ?? 2000) * attempt));
    }
  }
  if (!response) return { name: client.name, clientId, status: 'unreachable', reason: lastError };
  try {
    parseCimdDocument(clientId, response);
  } catch (error) {
    return {
      name: client.name,
      clientId,
      status: 'rejected',
      reason: error instanceof McpBoundaryError ? error.code : 'invalid_client',
    };
  }
  const live = new Map(Object.entries(JSON.parse(response.body) as Record<string, unknown>));
  const expected = new Map(Object.entries(client.fixture));
  const fields = COMPARED.filter(field => sorted(live.get(field)) !== sorted(expected.get(field)));
  return fields.length
    ? { name: client.name, clientId, status: 'drift', fields: [...fields] }
    : { name: client.name, clientId, status: 'match' };
}

async function main() {
  const summaryIndex = process.argv.indexOf('--summary');
  const results: CimdCheck[] = [];
  for (const { name, fixture } of CIMD_LIVE_CLIENTS) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed fixture list above
    const document = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, unknown>;
    const result = await checkCimdClient({ name, fixture: document }, url =>
      fetchPinnedMetadata(url)
    );
    results.push(result);
    // GitHub annotations; plain lines elsewhere.
    if (result.status === 'match') console.log(`${name}: live document matches ${fixture}`);
    else if (result.status === 'drift')
      console.log(
        `::warning::${name}: accepted, but ${result.fields.join(', ')} differ from ${fixture}`
      );
    else if (result.status === 'unreachable')
      console.log(`::warning::${name}: could not fetch ${result.clientId} (${result.reason})`);
    else
      console.log(
        `::error::${name}: this server would reject ${result.clientId} (${result.reason})`
      );
  }
  if (summaryIndex > 0 && process.argv[summaryIndex + 1])
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-chosen output path
    writeFileSync(process.argv[summaryIndex + 1], `${JSON.stringify(results, null, 2)}\n`);
  if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
}

// Run as a CLI only; the unit suite imports checkCimdClient.
if (typeof require !== 'undefined' && require.main === module) void main();
