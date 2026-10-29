import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, isMcpApprovalGated } from '@/lib/mcp/catalog';
import { reviewSummary } from '@/lib/mcp/approvals/operation';

describe('approval review summary', () => {
  it('shows every digest-bound input, including query parameters', () => {
    const summary = reviewSummary('setTeamLead', {
      path: { id: 'cabc123456789012345678901' },
      query: { dryRun: false, note: 'x'.repeat(500) },
      body: { userId: 'cabc123456789012345678902' },
      ifMatch: '"3"',
    });
    expect(summary.query).toEqual([
      ['dryRun', 'false'],
      ['note', 'x'.repeat(300)],
    ]);
    expect(summary.targets).toEqual({ id: 'cabc123456789012345678901' });
    expect(summary.ifMatch).toBe('"3"');
    expect(summary.changes).toEqual([['userId', 'cabc123456789012345678902']]);
  });
  it('defaults to no query parameters and withholds secret-like body fields', () => {
    const summary = reviewSummary('createStatusPageAnnouncement', {
      path: { id: 'p' },
      body: { title: 'T', message: 'M', apiToken: 'sk-secret-value' },
    });
    expect(summary.query).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain('sk-secret-value');
  });
  it('documents which gated operations accept query inputs so none is reviewed blind', () => {
    const withQuery = MCP_CATALOG.filter(isMcpApprovalGated).filter(
      operation =>
        Object.keys(
          ((operation.inputSchema as { properties: { query?: { properties?: object } } }).properties
            .query?.properties ?? {}) as object
        ).length > 0
    );
    // Today none do. If one is added, the summary above already displays its query inputs.
    expect(withQuery.map(operation => operation.operationId)).toEqual([]);
  });
});
