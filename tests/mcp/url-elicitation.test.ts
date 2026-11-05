import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer } from '@/lib/mcp/protocol/server';
import { CostBudget } from '@/lib/mcp/core/budget';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const approvals = vi.hoisted(() => ({
  prepare: vi.fn(),
  status: vi.fn(),
}));
vi.mock('@/lib/mcp/approvals/operation', () => ({
  prepareMcpOperation: approvals.prepare,
  getMcpOperationApproval: approvals.status,
}));

const scopes = [...supportedMcpScopes()].filter(scope => scope !== 'admin:manage');
const admin: AuthorizationActor = {
  id: 'admin_1',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
  apiKey: { id: 'grant_1', scopes },
};
const REVIEW_URL = 'http://localhost:3000/settings/integrations/mcp/approvals/operations/appr_1';
const APPROVAL_ID = 'appr_1234567890abcdefghij';
const gated = MCP_CATALOG.find(operation => operation.status === 'APPROVAL_REQUIRED')!;
const ARGS = {
  operationId: gated.operationId,
  args: {},
  idempotencyKey: 'prepare-elicit-0001',
};

const handlers: McpHttpHandler[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  approvals.prepare.mockReset();
  approvals.status.mockReset();
  await Promise.all(handlers.splice(0).map(handler => handler.close()));
});

function receipt() {
  approvals.prepare.mockResolvedValue({
    approvalId: APPROVAL_ID,
    status: 'REQUIRES_NATIVE_APPROVAL',
    expiresAt: '2026-11-05T14:00:00.000Z',
    reviewUrl: REVIEW_URL,
  });
  approvals.status.mockResolvedValue({
    approvalId: APPROVAL_ID,
    status: 'PENDING',
    expiresAt: '2026-11-05T14:00:00.000Z',
  });
}

interface Call {
  version?: '2026-07-28' | '2025-06-18' | '2025-11-25';
  capabilities?: Record<string, unknown>;
  actor?: AuthorizationActor;
  grantId?: string;
  extra?: Record<string, unknown>;
}
async function prepare(options: Call = {}) {
  const version = options.version ?? '2026-07-28';
  const modern = version === '2026-07-28';
  const actor = options.actor ?? admin;
  const handler = createMcpHandler(
    () =>
      createOpsKnightMcpServer(
        {
          grantId: options.grantId ?? 'grant_1',
          tokenScopes: scopes,
          requestId: 'req-elicit',
          budget: new CostBudget(),
        },
        actor,
        true,
        false,
        []
      ),
    { legacy: 'stateless', responseMode: 'json', maxSubscriptions: 0 }
  );
  handlers.push(handler);
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': version,
        ...(modern ? { 'mcp-method': 'tools/call', 'mcp-name': 'operation_prepare' } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'operation_prepare',
          arguments: ARGS,
          ...options.extra,
          ...(modern
            ? {
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': version,
                  'io.modelcontextprotocol/clientCapabilities': options.capabilities ?? {
                    elicitation: { url: {} },
                  },
                  'io.modelcontextprotocol/clientInfo': { name: 'elicit-test', version: '1' },
                },
              }
            : {}),
        },
      }),
    })
  );
  // 2025-era stateless responses may arrive as one SSE event.
  const text = await response.text();
  const event = text.split('\n').find(line => line.startsWith('data: '));
  return JSON.parse(event ? event.slice('data: '.length) : text);
}

describe('D6: URL elicitation for a self-approving administrator', () => {
  it('asks a supporting 2026 client to open the native review page, never a form', async () => {
    receipt();
    const body = await prepare();
    expect(body.error).toBeUndefined();
    expect(body.result.resultType).toBe('input_required');
    expect(body.result.inputRequests.review).toMatchObject({
      method: 'elicitation/create',
      params: { mode: 'url', url: REVIEW_URL },
    });
    expect(JSON.stringify(body.result)).not.toMatch(/requestedSchema|"form"/);
    expect(typeof body.result.requestState).toBe('string');
    expect(approvals.prepare).toHaveBeenCalledTimes(1);
  });

  it('answers the retry from the approval status and prepares nothing again', async () => {
    receipt();
    const first = await prepare();
    // Whatever the client claims, the reply is ignored: only the durable status counts.
    const retry = await prepare({
      extra: {
        requestState: first.result.requestState,
        inputResponses: { review: { action: 'accept', content: { approved: true } } },
      },
    });
    expect(retry.error).toBeUndefined();
    expect(retry.result.resultType).not.toBe('input_required');
    expect(retry.result.structuredContent).toMatchObject({
      approvalId: APPROVAL_ID,
      status: 'PENDING',
      reviewUrl: REVIEW_URL,
      nextSteps: { shareWithUser: REVIEW_URL, onApproved: 'operation_commit_approved' },
    });
    expect(approvals.prepare).toHaveBeenCalledTimes(1);
    expect(approvals.status).toHaveBeenCalledWith(expect.anything(), { approvalId: APPROVAL_ID });
  });

  it('refuses tampered, foreign and expired state with -32602', async () => {
    receipt();
    const state = (await prepare()).result.requestState as string;
    const tampered = await prepare({ extra: { requestState: `${state.slice(0, -2)}xx` } });
    expect(tampered.error.code).toBe(-32602);
    const foreignGrant = await prepare({ grantId: 'grant_2', extra: { requestState: state } });
    expect(foreignGrant.error.code).toBe(-32602);
    const foreignActor = await prepare({
      actor: { ...admin, id: 'admin_2' },
      extra: { requestState: state },
    });
    expect(foreignActor.error.code).toBe(-32602);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    const expired = await prepare({ extra: { requestState: state } });
    expect(expired.error.code).toBe(-32602);
    expect(approvals.status).not.toHaveBeenCalled();
  });

  it('keeps the shared link for clients without URL elicitation', async () => {
    receipt();
    const body = await prepare({ capabilities: { elicitation: { form: {} } } });
    expect(body.result.resultType).not.toBe('input_required');
    expect(body.result.structuredContent).toMatchObject({
      selfApprovable: true,
      nextSteps: { shareWithUser: REVIEW_URL },
    });
  });

  it.each(['2025-06-18', '2025-11-25'] as const)(
    'never returns input_required to a %s client',
    async version => {
      receipt();
      const body = await prepare({ version });
      expect(JSON.stringify(body)).not.toContain('input_required');
      expect(body.result.structuredContent.nextSteps.shareWithUser).toBe(REVIEW_URL);
    }
  );
});
