import { describe, expect, it } from 'vitest';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import { buildMcpParityReport } from '@/lib/mcp/catalog/parity';
import { operationReviewSchema } from '@/lib/mcp/catalog/review-schema';

describe('honest MCP workflow inventory', () => {
  it('accounts for every live operation in each dimension without treating blocked routes as parity', () => {
    const report = buildMcpParityReport(MCP_CATALOG);
    for (const groups of [report.byDomain, report.byRisk, report.byMethod, report.byDisposition]) {
      expect(groups.flatMap(group => group.operationIds).sort()).toEqual(
        MCP_CATALOG.map(op => op.operationId).sort()
      );
    }
    expect(report.pendingOperations).toContain('publishPostmortem');
    expect(report.pendingOperations).toContain('updatePostmortemActionItem');
    expect(report.pendingOperations).not.toContain('listPostmortemVersions');
    expect(report.implementationComplete).toBe(false);
    expect(report.certified).toBe(false);
    expect(report.reviewedExclusions).toBe(0);
    expect(report.operations.find(op => op.operationId === 'deletePostmortem')?.disposition).toBe(
      'PENDING_EXCLUSION_REVIEW'
    );
  });
  it('accounts for native runbook approvals without permitting generic execution', () => {
    const report = buildMcpParityReport(MCP_CATALOG);
    const execution = report.operations.find(op => op.operationId === 'executeRunbook')!;
    expect(execution.disposition).toBe('MCP_EQUIVALENT');
    expect(execution.executableCandidate).toBe(false);
    expect(execution.equivalent?.tools).toEqual([
      'runbook_prepare_execution',
      'runbook_execute_approved',
    ]);
    expect(report.equivalentMappings).toBe(1);
  });
  it('rejects unknown risk/status, empty reasons and sensitive generic exposure', () => {
    const review = MCP_CATALOG.find(op => op.operationId === 'getPostmortem')!;
    const base = {
      status: review.status,
      risk: review.risk,
      reason: review.reason,
      tool: review.tool,
      routeSha256: review.routeSha256,
      contractSha256: review.contractSha256,
      resourceFilter: review.resourceFilter,
      evidence: review.evidence,
      actions: review.actions,
    };
    expect(operationReviewSchema.safeParse(base).success).toBe(true);
    for (const change of [
      { risk: 'LOW' },
      { status: 'EXPOSED' },
      { reason: '  ' },
      { evidence: '' },
      { risk: 'R2' },
      { risk: 'R3' },
      { risk: 'R4' },
      { actions: [] },
      { status: 'CURATED', tool: null },
      { tool: 'guessed_tool' },
    ])
      expect(operationReviewSchema.safeParse({ ...base, ...change }).success).toBe(false);
    expect(
      operationReviewSchema.safeParse({ ...base, status: 'DENIED_WITH_REASON', risk: 'R4' }).success
    ).toBe(true);
  });
});
