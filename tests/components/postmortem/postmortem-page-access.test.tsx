import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const mocks = vi.hoisted(() => ({
  getPostmortem: vi.fn(),
  getUserPermissions: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
  incidentFindFirst: vi.fn(),
  postmortemCount: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: {} }) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(),
}));
vi.mock('@/lib/access/server', () => ({ requirePageAccess: vi.fn() }));
vi.mock('@/app/(app)/postmortems/actions', () => ({ getPostmortem: mocks.getPostmortem }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: mocks.getUserPermissions,
  getCurrentAuthorizationActor: mocks.getCurrentAuthorizationActor,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findFirst: mocks.incidentFindFirst },
    postmortem: { count: mocks.postmortemCount },
    user: { findMany: mocks.userFindMany },
  },
}));
vi.mock('@/lib/jira-capabilities', () => ({ getJiraCapabilities: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/jira-references', () => ({ serializeJiraIssueReference: vi.fn() }));
vi.mock('@/lib/intelligence/ai/settings', () => ({
  getAiSettings: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('@/components/PostmortemForm', () => ({
  default: () => <div>postmortem editor</div>,
}));
vi.mock('@/components/postmortem/PostmortemDetailView', () => ({
  default: ({ canEdit }: { canEdit: boolean }) => <div>detail view canEdit={String(canEdit)}</div>,
}));

import PostmortemPage from '@/app/(app)/postmortems/[incidentId]/page';

const responder: AuthorizationActor = {
  id: 'responder-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: [],
};

async function renderPage() {
  render(
    await PostmortemPage({
      params: Promise.resolve({ incidentId: 'inc-1' }),
      searchParams: Promise.resolve({}),
    })
  );
}

describe('per-incident postmortem page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserPermissions.mockResolvedValue({ isResponderOrAbove: true });
    mocks.getCurrentAuthorizationActor.mockResolvedValue(responder);
    mocks.incidentFindFirst.mockResolvedValue({
      id: 'inc-1',
      title: 'DB down',
      status: 'RESOLVED',
      serviceId: 'svc-1',
      externalIssueLinks: [],
    });
    mocks.userFindMany.mockResolvedValue([]);
  });

  it('does not offer Edit to a responder who could not save the change', async () => {
    mocks.getPostmortem.mockResolvedValue({
      id: 'pm-1',
      title: 'Outage',
      status: 'PUBLISHED',
      incident: { title: 'DB down' },
    });
    mocks.postmortemCount.mockResolvedValue(0);

    await renderPage();

    expect(screen.getByText('detail view canEdit=false')).toBeTruthy();
    // The edit scope is applied to this incident, so only the author, assignee, team and admins pass.
    expect(mocks.postmortemCount.mock.calls[0]![0].where.AND[0]).toEqual({ incidentId: 'inc-1' });
    expect(mocks.postmortemCount.mock.calls[0]![0].where.AND[1]).toHaveProperty('OR');
  });

  it('offers Edit to someone the save would accept', async () => {
    mocks.getPostmortem.mockResolvedValue({
      id: 'pm-1',
      title: 'Outage',
      status: 'DRAFT',
      incident: { title: 'DB down' },
    });
    mocks.postmortemCount.mockResolvedValue(1);

    await renderPage();

    expect(screen.getByText('detail view canEdit=true')).toBeTruthy();
  });

  it('says a hidden postmortem exists instead of offering to create another', async () => {
    mocks.getPostmortem.mockResolvedValue(null);
    mocks.postmortemCount.mockResolvedValue(1);

    await renderPage();

    expect(screen.getByText('Postmortem not visible')).toBeTruthy();
    expect(screen.queryByText('postmortem editor')).toBeNull();
  });

  it('still offers the create form when the incident has no postmortem', async () => {
    mocks.getPostmortem.mockResolvedValue(null);
    mocks.postmortemCount.mockResolvedValue(0);

    await renderPage();

    expect(screen.getByText('postmortem editor')).toBeTruthy();
  });
});
