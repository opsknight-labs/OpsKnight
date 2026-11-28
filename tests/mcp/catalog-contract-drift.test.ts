import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, mcpContractHash } from '@/lib/mcp/catalog';

// An operation whose pinned contract hash no longer matches silently leaves the approval-gated set
// (it fails closed), so a stale pin must fail here instead of surfacing in an integration test.
describe('MCP catalog contract pins', () => {
  it('pins the current contract of every operation', () => {
    const stale = MCP_CATALOG.filter(op => mcpContractHash(op) !== op.contractSha256).map(
      op => op.operationId
    );
    expect(stale).toEqual([]);
  });
});
