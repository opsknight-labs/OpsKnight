import { readFileSync as fsRead } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
import { CIMD_LIVE_CLIENTS, checkCimdClient } from '../../scripts/mcp/cimd-live-check';
import { McpBoundaryError } from '@/lib/mcp/core/errors';

// Checked-in fixture paths only, from the script's own list.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository fixture paths only
const readFixture = (path: string) => JSON.parse(fsRead(path, 'utf8')) as Record<string, unknown>;

/** CERT-09: the nightly drift check's verdicts, without the network. */
describe('CIMD live drift check', () => {
  const fixture = readFixture(CIMD_LIVE_CLIENTS[0].fixture);
  const client = { name: 'Claude', fixture };
  const served =
    (document: Record<string, unknown>, contentType = 'application/json') =>
    () =>
      Promise.resolve({ status: 200, contentType, body: JSON.stringify(document) });

  it('passes when the live document equals the fixture the unit suite uses', async () => {
    expect(await checkCimdClient(client, served(fixture))).toMatchObject({ status: 'match' });
    // Display-only changes are not drift; array order is not either.
    expect(
      await checkCimdClient(
        client,
        served({
          ...fixture,
          client_name: 'Claude (new)',
          grant_types: [...(fixture.grant_types as string[])].reverse(),
        })
      )
    ).toMatchObject({ status: 'match' });
  });

  it('warns when an accepted document changes a sign-in field', async () => {
    expect(
      await checkCimdClient(
        client,
        served({ ...fixture, redirect_uris: ['https://claude.ai/api/mcp/new_callback'] })
      )
    ).toEqual({
      name: 'Claude',
      clientId: fixture.client_id,
      status: 'drift',
      fields: ['redirect_uris'],
    });
  });

  it('fails when this server would reject the live document', async () => {
    expect(
      await checkCimdClient(client, served({ ...fixture, grant_types: ['client_credentials'] }))
    ).toMatchObject({ status: 'rejected', reason: 'invalid_client' });
    expect(await checkCimdClient(client, served(fixture, 'text/html'))).toMatchObject({
      status: 'rejected',
    });
  });

  it('retries network errors and then reports them as a warning, not a failure', async () => {
    const fetchDocument = vi
      .fn()
      .mockRejectedValue(new McpBoundaryError('MCP_CLIENT_METADATA_TIMEOUT', 504));
    expect(await checkCimdClient(client, fetchDocument, { attempts: 3, backoffMs: 0 })).toEqual({
      name: 'Claude',
      clientId: fixture.client_id,
      status: 'unreachable',
      reason: 'MCP_CLIENT_METADATA_TIMEOUT',
    });
    expect(fetchDocument).toHaveBeenCalledTimes(3);
    // A later attempt that succeeds is used.
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new McpBoundaryError('MCP_CLIENT_METADATA_UNAVAILABLE', 502))
      .mockImplementation(served(fixture));
    expect(await checkCimdClient(client, flaky, { backoffMs: 0 })).toMatchObject({
      status: 'match',
    });
  });

  it('runs from its own scheduled workflow, never the hermetic certification one', () => {
    const drift = fsRead('.github/workflows/mcp-cimd-drift.yml', 'utf8');
    expect(drift).toContain('npm run mcp:cimd-check');
    expect(drift).toMatch(/schedule:/);
    expect(drift).not.toMatch(/pull_request/);

    expect(fsRead('.github/workflows/mcp-certification.yml', 'utf8')).not.toContain(
      'mcp:cimd-check'
    );
  });
});
