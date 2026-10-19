import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SETTINGS_NAV_ITEMS, SETTINGS_NAV_SECTIONS } from '@/components/settings/navConfig';
import ServiceObjectivesPage from '@/app/(app)/settings/service-objectives/page';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/prisma', () => ({ default: { serviceObjective: { findMany: mocks.list } } }));
vi.mock('@/components/settings/ServiceObjectiveForm', () => ({
  ServiceObjectiveForm: () => <div>Objective mutation form</div>,
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: 'admin', role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
  mocks.list.mockResolvedValue([]);
});
describe('Service objectives management', () => {
  it('makes the supported management page discoverable in settings navigation', () => {
    expect(SETTINGS_NAV_ITEMS.find(item => item.id === 'service-objectives')?.href).toBe(
      '/settings/service-objectives'
    );
    expect(
      SETTINGS_NAV_SECTIONS.flatMap(section => section.items).filter(
        item => item.id === 'service-objectives'
      )
    ).toHaveLength(1);
  });
  it('offers administrators creation and explains measurement limits', async () => {
    render(await ServiceObjectivesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: 'Service objectives' })).toBeInTheDocument();
    expect(screen.getByText('Objective mutation form')).toBeInTheDocument();
    expect(screen.getByText(/Availability measures uptime/)).toBeInTheDocument();
    expect(screen.getByText(/No measurement is not compliance/)).toBeInTheDocument();
  });
  it('does not offer mutations to scoped users and bounds the service-filtered query', async () => {
    mocks.actor.mockResolvedValue({
      id: 'member',
      role: 'USER',
      status: 'ACTIVE',
      teamIds: ['team'],
    });
    render(await ServiceObjectivesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText('Objective mutation form')).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 26,
        where: expect.objectContaining({
          activeTo: null,
          serviceId: { not: null },
          service: expect.any(Object),
        }),
      })
    );
  });
  it('keeps unsupported legacy measurements readable and archivable without offering invalid edits', async () => {
    mocks.list.mockResolvedValue([
      {
        id: 'legacy',
        lineageId: 'legacy',
        version: 1,
        name: 'Legacy latency',
        service: null,
        metricType: 'LATENCY_P99',
        target: 250,
        comparator: 'LESS_THAN_OR_EQUAL',
        windowType: 'SEVEN_DAYS',
        description: null,
        windowValue: null,
      },
    ]);
    render(await ServiceObjectivesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: 'Legacy latency' })).toBeInTheDocument();
    expect(screen.queryByText('Edit objective')).not.toBeInTheDocument();
    expect(screen.getByText('Archive objective')).toBeInTheDocument();
    expect(screen.getByText(/legacy target; evaluation unavailable/)).toBeInTheDocument();
  });
  it('requires authentication before querying objective definitions', async () => {
    mocks.actor.mockRejectedValue(new Error('Authentication required'));
    await expect(ServiceObjectivesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'Authentication required'
    );
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
