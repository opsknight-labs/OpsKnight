import { randomBytes } from 'node:crypto';
import { createTestStatusPage, createTestTeam, createTestUser, testPrisma as db } from './test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { MCP_CATALOG, isMcpApprovalGated } from '@/lib/mcp/catalog';
import { CostBudget } from '@/lib/mcp/core/budget';
import type { ExecutionContext } from '@/lib/mcp/core/execution';
import { decideMcpOperationReview, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

// Every approval-gated operation's scopes, so a batch never depends on a hand-kept list.
export const scopes = [
  ...new Set(MCP_CATALOG.filter(isMcpApprovalGated).flatMap(operation => operation.requiredScopes)),
];

export async function connect(userId: string, tokenVersion: number) {
  const client = await db.mcpClient.create({
    data: { name: 'Approval client', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId,
      userTokenVersion: tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const bearer = randomBytes(32).toString('base64url');
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const ctx = (): ExecutionContext => ({
    grantId: grant.id,
    credentialId: token.id,
    tokenScopes: scopes,
    requestId: 'operation-approval-test',
    budget: new CostBudget(),
  });
  return { client, grant, token, bearer, ctx };
}

export async function fixture() {
  const user = await createTestUser({ role: 'ADMIN' });
  const reviewer = await createTestUser({ role: 'ADMIN' });
  const connection = await connect(user.id, user.tokenVersion);
  const team = await createTestTeam('Approval team');
  const lead = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { teamId: team.id, userId: lead.id } });
  const page = await createTestStatusPage();
  const teamRevision = async () =>
    (await db.team.findUniqueOrThrow({ where: { id: team.id } })).revision;
  const leadArgs = async () => ({
    operationId: 'setTeamLead',
    args: {
      path: { id: team.id },
      body: { userId: lead.id },
      ifMatch: `"${await teamRevision()}"`,
    },
    idempotencyKey: `prepare-${randomBytes(8).toString('hex')}`,
  });
  const announcementArgs = (title = 'Planned maintenance') => ({
    operationId: 'createStatusPageAnnouncement',
    args: { path: { id: page.id }, body: { title, message: 'Reviewed message', type: 'INFO' } },
    idempotencyKey: `prepare-${randomBytes(8).toString('hex')}`,
  });
  const review = (
    prepared: { approvalId: string; operationDigest: string },
    decision: 'approve' | 'reject' = 'approve',
    by: { id: string; tokenVersion: number } = reviewer
  ) =>
    decideMcpOperationReview(
      { id: prepared.approvalId, operationDigest: prepared.operationDigest, decision },
      by
    );
  return {
    user,
    reviewer,
    team,
    lead,
    page,
    teamRevision,
    leadArgs,
    announcementArgs,
    review,
    ...connection,
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function approvedLead(f: Fixture) {
  const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
  await f.review(prepared);
  return prepared;
}
