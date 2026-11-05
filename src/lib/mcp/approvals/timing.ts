import type { Prisma } from '@prisma/client';

/** Defaults and bounds match the McpPolicy columns and their database checks. */
export const MCP_APPROVAL_TTL_DEFAULT_MINUTES = 240;
export const MCP_APPROVAL_TTL_MIN_MINUTES = 15;
export const MCP_APPROVAL_TTL_MAX_MINUTES = 1440;
export const MCP_APPROVAL_COMMIT_WINDOW_DEFAULT_MINUTES = 30;
export const MCP_APPROVAL_COMMIT_WINDOW_MAX_MINUTES = 1440;
/** No approval, however it was reviewed, can be used later than this after it was requested. */
export const MCP_APPROVAL_ABSOLUTE_MAX_MS = 24 * 60 * 60_000;

export type McpApprovalTiming = { ttlMinutes: number; commitWindowMinutes: number };

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** The administrator's review and commit windows, clamped so a bad row can never widen them. */
export async function readMcpApprovalTiming(
  tx: Pick<Prisma.TransactionClient, 'mcpPolicy'>
): Promise<McpApprovalTiming> {
  const policy = await tx.mcpPolicy.findUnique({
    where: { id: 'default' },
    select: { approvalTtlMinutes: true, approvalCommitWindowMinutes: true },
  });
  return {
    ttlMinutes: clamp(
      policy?.approvalTtlMinutes ?? MCP_APPROVAL_TTL_DEFAULT_MINUTES,
      MCP_APPROVAL_TTL_MIN_MINUTES,
      MCP_APPROVAL_TTL_MAX_MINUTES,
      MCP_APPROVAL_TTL_DEFAULT_MINUTES
    ),
    commitWindowMinutes: clamp(
      policy?.approvalCommitWindowMinutes ?? MCP_APPROVAL_COMMIT_WINDOW_DEFAULT_MINUTES,
      1,
      MCP_APPROVAL_COMMIT_WINDOW_MAX_MINUTES,
      MCP_APPROVAL_COMMIT_WINDOW_DEFAULT_MINUTES
    ),
  };
}

/** How long a new request waits for review. */
export function reviewDeadline(timing: McpApprovalTiming, now = Date.now()) {
  return new Date(now + timing.ttlMinutes * 60_000);
}

/**
 * Approval starts a fresh commit window, so a change approved late in its review window can still
 * be applied, but never beyond the absolute cap measured from the request.
 */
export function commitDeadline(timing: McpApprovalTiming, createdAt: Date, now = Date.now()) {
  return new Date(
    Math.min(
      now + timing.commitWindowMinutes * 60_000,
      createdAt.getTime() + MCP_APPROVAL_ABSOLUTE_MAX_MS
    )
  );
}
