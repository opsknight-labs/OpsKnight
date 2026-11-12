import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMcpOperation = vi.fn();
vi.mock('@/lib/mcp/core/execution', () => ({ callMcpOperation }));

const { listAuthorizedResources, RESOURCE_LIST_LIMIT } = await import(
  '@/lib/mcp/protocol/resource-list'
);
const context = {} as Parameters<typeof listAuthorizedResources>[0];

beforeEach(() => {
  callMcpOperation.mockReset();
});

describe('listAuthorizedResources', () => {
  it('reads one bounded page through the list operation, open incidents only', async () => {
    callMcpOperation.mockResolvedValue({ data: { data: [] } });
    await listAuthorizedResources(context, 'incidents');
    expect(callMcpOperation).toHaveBeenCalledWith(context, 'listIncidents', {
      query: { limit: RESOURCE_LIST_LIMIT, status: 'ACTIVE' },
    });
    await listAuthorizedResources(context, 'reports');
    expect(callMcpOperation).toHaveBeenLastCalledWith(context, 'listSavedReports', {
      query: { limit: RESOURCE_LIST_LIMIT },
    });
  });

  it('names rows on one line and drops rows without a safe id', async () => {
    callMcpOperation.mockResolvedValue({
      data: {
        data: [
          { id: 'svc_1', name: 'Payments\n\u0007on\t call' },
          { id: 'svc_2', title: '   ' },
          { id: '../escape', name: 'bad' },
          { name: 'no id' },
          null,
          ...Array.from({ length: 30 }, (_, i) => ({ id: `svc_x${i}`, name: 'x'.repeat(200) })),
        ],
      },
    });
    const { resources } = await listAuthorizedResources(context, 'services');
    expect(resources).toHaveLength(RESOURCE_LIST_LIMIT - 3);
    expect(resources[0]).toEqual({
      uri: 'opsknight://services/svc_1',
      name: 'Payments on call',
      mimeType: 'application/json',
    });
    expect(resources[1]?.name).toBe('svc_2');
    expect(resources.every(resource => !/[\n\r\t]/.test(resource.name))).toBe(true);
    expect(resources[2]?.name).toHaveLength(80);
  });

  it('lists nothing for a domain whose read is refused', async () => {
    callMcpOperation.mockRejectedValue(new Error('MCP_SCOPE_REQUIRED'));
    expect(await listAuthorizedResources(context, 'runbooks')).toEqual({ resources: [] });
  });
});
