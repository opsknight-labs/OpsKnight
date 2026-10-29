import { it } from 'vitest';

// Runs only as a child process of mcp-fault-injection.test.ts, which kills it at chosen points.
const child = process.env.MCP_FAULT_CHILD === '1';

it.skipIf(!child)(
  'fault-injection child: commits one approved operation',
  async () => {
    const { commitApprovedMcpOperation } = await import('@/lib/mcp/approvals/operation');
    const { CostBudget } = await import('@/lib/mcp/core/budget');
    process.stdout.write('FAULT_CHILD_STARTED\n');
    const result = await commitApprovedMcpOperation(
      {
        grantId: process.env.MCP_FAULT_GRANT!,
        credentialId: process.env.MCP_FAULT_CREDENTIAL!,
        tokenScopes: JSON.parse(process.env.MCP_FAULT_SCOPES!) as string[],
        requestId: 'fault-child',
        budget: new CostBudget(16, 262144, undefined, 120_000),
      },
      { approvalId: process.env.MCP_FAULT_APPROVAL! }
    );
    process.stdout.write(`FAULT_CHILD_DONE ${result.status}\n`);
  },
  180_000
);
