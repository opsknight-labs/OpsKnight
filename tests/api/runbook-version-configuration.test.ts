import { beforeEach, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { assertCapability } from '@/lib/rbac';
import { GET } from '@/app/api/runbooks/versions/[id]/configuration/route';
vi.mock('@/lib/prisma', () => ({ default: { runbookVersion: { findFirst: vi.fn() } } }));
vi.mock('@/lib/rbac', () => ({ assertCapability: vi.fn() }));
const id = 'cmv7kbd0l000exlzuo1cmhu1e';
const runbookId = 'cmv7kbd0l000dxlzuo1cmhu1e';
beforeEach(() => vi.resetAllMocks());
it('denies service-only users before loading any version configuration', async () => {
  vi.mocked(assertCapability).mockRejectedValue(new Error('Forbidden'));
  const response = await GET(
    new Request(
      `http://localhost/api/runbooks/versions/${id}/configuration?runbookId=${runbookId}`
    ),
    { params: Promise.resolve({ id }) }
  );
  expect(response.status).toBe(403);
  expect(prisma.runbookVersion.findFirst).not.toHaveBeenCalled();
});
it('scopes a selected version and returns its input schema/risk without its command definition', async () => {
  vi.mocked(assertCapability).mockResolvedValue({ id: 'actor' } as never);
  vi.mocked(prisma.runbookVersion.findFirst).mockResolvedValue({
    id,
    inputs: [],
    definition: {
      steps: [
        {
          key: 'diagnose',
          name: 'Private definition marker',
          type: 'LINUX_DIAGNOSTICS',
          riskClass: 'READ_ONLY',
          config: { action: 'summary' },
        },
      ],
    },
  } as never);
  const response = await GET(
    new Request(
      `http://localhost/api/runbooks/versions/${id}/configuration?runbookId=${runbookId}`
    ),
    { params: Promise.resolve({ id }) }
  );
  expect(response.status).toBe(200);
  expect(prisma.runbookVersion.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ id, runbookId }) })
  );
  const body = await response.json();
  expect(body.data).toEqual({ id, inputs: [], hasAgentWrite: false });
  expect(JSON.stringify(body)).not.toContain('Private definition marker');
});
