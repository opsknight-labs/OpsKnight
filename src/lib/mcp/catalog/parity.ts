import { isMcpApprovalGated, isMcpExecutable, type MCP_CATALOG } from './index';

type Operation = (typeof MCP_CATALOG)[number];
type Disposition =
  | 'CURATED_TOOL'
  | 'DISCOVERABLE'
  | 'APPROVAL_REQUIRED'
  | 'MCP_EQUIVALENT'
  | 'PENDING_IMPLEMENTATION'
  | 'PENDING_EXCLUSION_REVIEW';

// An alternative is accounted for only when an implemented workflow and tests exist.
// This does not permit generic execution of the underlying sensitive operation.
const equivalents = new Map([
  [
    'executeRunbook',
    {
      tools: ['runbook_prepare_execution', 'runbook_execute_approved'],
      approval: 'Different authorized human in the native UI; exact frozen plan.',
      evidence: [
        'tests/integration/mcp-runbook-approval.test.ts',
        'tests/e2e/mcp-approval.spec.ts',
      ],
    },
  ],
]);

export function buildMcpParityReport(operations: readonly Operation[]) {
  const entries = operations.map(operation => {
    const executableCandidate = isMcpExecutable(operation);
    const equivalent = equivalents.get(operation.operationId) ?? null;
    const approvalGated = isMcpApprovalGated(operation);
    const disposition: Disposition = executableCandidate
      ? operation.tool
        ? 'CURATED_TOOL'
        : 'DISCOVERABLE'
      : approvalGated
        ? 'APPROVAL_REQUIRED'
        : equivalent
          ? 'MCP_EQUIVALENT'
          : operation.status === 'DENIED_WITH_REASON'
            ? 'PENDING_EXCLUSION_REVIEW'
            : 'PENDING_IMPLEMENTATION';
    return {
      operationId: operation.operationId,
      domain: operation.domain,
      method: operation.method.toUpperCase(),
      risk: operation.risk,
      disposition,
      executableCandidate,
      equivalent,
      reason: operation.reason,
      evidence: operation.evidence,
      // Existing deny reasons are safety boundaries, not independent parity sign-off.
      parityReview: 'pending' as const,
      blocker:
        disposition === 'PENDING_IMPLEMENTATION'
          ? operation.method === 'get'
            ? 'Review read projection, resource authorization, redaction and bounded cost.'
            : 'Implement shared command mapping and required approval/recovery tests.'
          : disposition === 'PENDING_EXCLUSION_REVIEW'
            ? 'Review exclusion per operation and document a safe alternative where applicable.'
            : null,
    };
  });
  function groups(key: 'domain' | 'risk' | 'method' | 'disposition') {
    const select = (entry: (typeof entries)[number]) =>
      key === 'domain'
        ? entry.domain
        : key === 'risk'
          ? entry.risk
          : key === 'method'
            ? entry.method
            : entry.disposition;
    return [...new Set(entries.map(select))].sort().map(value => {
      const matching = entries.filter(entry => select(entry) === value);
      return {
        key: value,
        classified: matching.length,
        executableCandidates: matching.filter(entry => entry.executableCandidate).length,
        equivalentMappings: matching.filter(entry => entry.disposition === 'MCP_EQUIVALENT').length,
        approvalGated: matching.filter(entry => entry.disposition === 'APPROVAL_REQUIRED').length,
        gaps: matching.filter(entry => entry.blocker !== null).length,
        operationIds: matching.map(entry => entry.operationId).sort(),
      };
    });
  }
  const gaps = entries.filter(entry => entry.blocker !== null);
  return {
    classificationComplete: true,
    implementationComplete: gaps.length === 0,
    // Neither complete classification nor local handler tests are release certification.
    certified: false,
    independentParityReview: 'pending',
    reviewedExclusions: 0,
    genericExecutableCandidates: entries.filter(entry => entry.executableCandidate).length,
    equivalentMappings: entries.filter(entry => entry.disposition === 'MCP_EQUIVALENT').length,
    approvalGatedOperations: entries.filter(entry => entry.disposition === 'APPROVAL_REQUIRED')
      .length,
    pendingOperations: gaps.map(entry => entry.operationId),
    byDomain: groups('domain'),
    byRisk: groups('risk'),
    byMethod: groups('method'),
    byDisposition: groups('disposition'),
    operations: entries,
  };
}
