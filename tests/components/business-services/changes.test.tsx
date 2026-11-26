import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ bs: vi.fn(), changes: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    businessService: { findFirst: mocks.bs },
    changeEvent: { findMany: mocks.changes },
  },
}));

import { listBusinessServiceChanges } from '@/lib/business-services/changes';
import { ChangesPanel } from '@/components/business-service/ChangesPanel';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const admin: AuthorizationActor = { id: 'u', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
const scoped: AuthorizationActor = { id: 'v', role: 'USER', status: 'ACTIVE', teamIds: ['team_a'] };
const window = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-08T00:00:00Z') };
const change = {
  id: 'c1',
  serviceId: 'svc1',
  source: 'github',
  kind: 'DEPLOY',
  summary: 'Deploy checkout-api v42',
  version: 'v42',
  url: 'javascript:alert(1)',
  occurredAt: new Date('2026-11-02T10:00:00Z'),
  riskScore: 0.4,
  service: { name: 'checkout-api' },
};

describe('listBusinessServiceChanges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads changes of the member services in the window, newest first, without unsafe links', async () => {
    mocks.bs.mockResolvedValue({ members: [{ serviceId: 'svc1' }, { serviceId: 'svc2' }] });
    mocks.changes.mockResolvedValue([change]);
    const rows = await listBusinessServiceChanges('bs1', window, admin, 500);
    expect(rows).toEqual([
      expect.objectContaining({ id: 'c1', serviceName: 'checkout-api', url: null, version: 'v42' }),
    ]);
    const query = mocks.changes.mock.calls[0][0];
    expect(query.take).toBe(200);
    expect(query.orderBy).toEqual([{ occurredAt: 'desc' }, { id: 'desc' }]);
    expect(query.where.AND).toEqual([
      {},
      { serviceId: { in: ['svc1', 'svc2'] } },
      { occurredAt: { gte: window.from, lt: window.to } },
    ]);
  });

  it('limits a team-scoped reader to changes of their teams services', async () => {
    mocks.bs.mockResolvedValue({ members: [{ serviceId: 'svc1' }] });
    mocks.changes.mockResolvedValue([]);
    await listBusinessServiceChanges('bs1', window, scoped);
    expect(mocks.bs.mock.calls[0][0].where.AND[1]).toHaveProperty('OR');
    expect(mocks.changes.mock.calls[0][0].where.AND[0]).toHaveProperty('service');
  });

  it('returns nothing for a business service without members and 404s an unreadable one', async () => {
    mocks.bs.mockResolvedValueOnce({ members: [] });
    expect(await listBusinessServiceChanges('bs1', window, admin)).toEqual([]);
    expect(mocks.changes).not.toHaveBeenCalled();
    mocks.bs.mockResolvedValueOnce(null);
    await expect(listBusinessServiceChanges('bs1', window, admin)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});

describe('ChangesPanel', () => {
  it('lists each change with kind, service and source, linking only http(s) urls', () => {
    render(
      <ChangesPanel
        changes={[
          {
            ...change,
            serviceId: 'svc1',
            serviceName: 'checkout-api',
            url: 'https://ci.example.com/1',
          },
          {
            ...change,
            id: 'c2',
            serviceId: 'svc1',
            serviceName: 'checkout-api',
            summary: 'Flag on',
            kind: 'FEATURE_FLAG',
            url: null,
          },
        ]}
      />
    );
    expect(screen.getByRole('link', { name: /Deploy checkout-api v42/ })).toHaveAttribute(
      'href',
      'https://ci.example.com/1'
    );
    expect(screen.getByText('Flag on')).toBeInTheDocument();
    expect(screen.getAllByText(/on checkout-api via github/)).toHaveLength(2);
    expect(screen.getByText(/Feature flag/)).toBeInTheDocument();
  });

  it('explains an empty window', () => {
    render(<ChangesPanel changes={[]} />);
    expect(screen.getByText('No changes in the last 7 days')).toBeInTheDocument();
  });
});
