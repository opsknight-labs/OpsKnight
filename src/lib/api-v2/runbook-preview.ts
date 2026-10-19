import type { ExecutionPreview } from '@/lib/runbooks/execution-preview';
/** Keep configuration and inputs out of ordinary execution previews. */
export function projectExecutionPreview(preview: ExecutionPreview) {
  return {
    digest: preview.digest,
    expiresAt: preview.expiresAt,
    versionId: preview.versionId,
    version: preview.version,
    checksum: preview.checksum,
    agentId: preview.agentId,
    agentPoolId: preview.agentPoolId,
    timeoutSeconds: preview.timeoutSeconds,
    readiness: preview.readiness,
    steps: preview.steps.map(
      ({ key, name, type, risk, purpose, requiresApproval, timeoutSeconds }) => ({
        key,
        name,
        type,
        risk,
        purpose,
        requiresApproval,
        timeoutSeconds,
      })
    ),
  };
}
