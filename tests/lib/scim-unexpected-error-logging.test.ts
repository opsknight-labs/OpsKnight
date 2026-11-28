import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { handle } from '@/lib/scim/protocol/http';
import { ScimFailure } from '@/lib/scim/protocol/validation';
import { adminFailure } from '@/lib/scim/security/admin-errors';

describe('unexpected SCIM errors are logged', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the cause under the request id and still answers a generic 503', async () => {
    const cause = new Error('relation "ScimGroup" does not exist');

    const response = await handle(async () => {
      throw cause;
    });

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('ScimGroup');
    expect(m.error).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected error'),
      expect.objectContaining({ error: cause, requestId: response.headers.get('X-Request-ID') })
    );
  });

  it('does not log expected protocol failures as errors', async () => {
    const response = await handle(async () => {
      throw new ScimFailure(400, 'Invalid filter', 'invalidFilter');
    });

    expect(response.status).toBe(400);
    expect(m.error).not.toHaveBeenCalled();
  });

  it('logs an unexpected administration failure and returns the generic message', () => {
    const cause = new Error('connection refused');

    const result = adminFailure(cause);

    expect(result.scimError).toContain('temporarily unavailable');
    expect(m.error).toHaveBeenCalledWith(
      expect.stringContaining('administration'),
      expect.objectContaining({ error: cause })
    );
  });
});
