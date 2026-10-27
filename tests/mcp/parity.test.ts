import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { MCP_APPROVAL_HANDLERS, MCP_HANDLERS } from '@/lib/mcp/operations/handlers';
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
  it('only approval-gates replay-safe sensitive writes and never exposes them generically', () => {
    const gated = MCP_CATALOG.filter(isMcpApprovalGated);
    expect(gated.map(op => op.operationId).sort()).toEqual(
      [...MCP_APPROVAL_HANDLERS.keys()].sort()
    );
    for (const operation of gated) {
      expect(operation.risk).toBe('R2');
      expect(operation.method).not.toBe('get');
      expect(operation.tool).toBeNull();
      expect(isMcpExecutable(operation)).toBe(false);
      expect(MCP_HANDLERS.has(operation.operationId)).toBe(false);
      expect(['required', 'supported']).toContain(operation.mutation?.idempotency);
    }
    const report = buildMcpParityReport(MCP_CATALOG);
    expect(report.approvalGatedOperations).toBe(gated.length);
    expect(report.pendingOperations).not.toContain(gated[0]?.operationId);
  });
  it('limits the approval status to sensitive configuration', () => {
    const review = MCP_CATALOG.find(op => op.operationId === 'setTeamLead')!;
    const base = {
      status: 'APPROVAL_REQUIRED',
      risk: 'R2',
      reason: review.reason,
      tool: null,
      routeSha256: review.routeSha256,
      contractSha256: review.contractSha256,
      resourceFilter: review.resourceFilter,
      evidence: review.evidence,
      actions: review.actions,
    };
    expect(operationReviewSchema.safeParse(base).success).toBe(true);
    for (const change of [{ risk: 'R3' }, { risk: 'R4' }, { risk: 'R0' }, { tool: 'named_tool' }])
      expect(operationReviewSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
});
