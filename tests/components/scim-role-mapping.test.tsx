import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScimRoleMapping from '@/components/settings/ScimRoleMapping';
const actions = vi.hoisted(() => ({
  getScimRoleMappingAction: vi.fn(),
  previewScimRoleMappingAction: vi.fn(),
  saveScimRoleMappingAction: vi.fn(),
}));
vi.mock('@/app/(app)/settings/system/scim-role-actions', () => actions);
beforeEach(() => {
  vi.resetAllMocks();
  actions.getScimRoleMappingAction.mockResolvedValue({
    name: 'Entra Responders',
    systemRole: null,
  });
  actions.previewScimRoleMappingAction.mockResolvedValue({
    members: 3,
    changedUsers: 2,
    adoptedUsers: 1,
    demotions: 0,
    revision: 'a'.repeat(64),
  });
  actions.saveScimRoleMappingAction.mockResolvedValue({ changedUsers: 2 });
});
it('requires a preview, explains authority takeover, then applies the pinned revision', async () => {
  const onSaved = vi.fn();
  render(<ScimRoleMapping connectorId="c" groupId="g" onSaved={onSaved} />);
  expect(screen.queryByRole('button', { name: 'Apply role mapping' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('OpsKnight system role')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('OpsKnight system role'), {
    target: { value: 'RESPONDER' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview role mapping' }));
  expect(
    await screen.findByText(/1 move from manual or OIDC roles to SCIM control/)
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply role mapping' }));
  await waitFor(() =>
    expect(actions.saveScimRoleMappingAction).toHaveBeenCalledWith({
      connectorId: 'c',
      groupId: 'g',
      role: 'RESPONDER',
      revision: 'a'.repeat(64),
    })
  );
  expect(await screen.findByText('Role mapping saved. 2 accounts updated.')).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledOnce();
});
it('invalidates a preview on selection change and requires another after a stale failure', async () => {
  render(<ScimRoleMapping connectorId="c" groupId="g" onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('OpsKnight system role')).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Preview role mapping' }));
  await screen.findByRole('button', { name: 'Apply role mapping' });
  fireEvent.change(screen.getByLabelText('OpsKnight system role'), { target: { value: 'ADMIN' } });
  expect(screen.queryByRole('button', { name: 'Apply role mapping' })).not.toBeInTheDocument();
  actions.saveScimRoleMappingAction.mockResolvedValue({
    scimError: 'Membership or operational impact changed. Preview again.',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview role mapping' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Apply role mapping' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Preview again');
  expect(screen.queryByRole('button', { name: 'Apply role mapping' })).not.toBeInTheDocument();
});
