import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScimSettingsSection from '@/components/settings/ScimSettingsSection';
const actions = vi.hoisted(() => ({
  scimOverviewAction: vi.fn(),
  scimDirectoryAction: vi.fn(),
  saveScimConnectorAction: vi.fn(),
  createScimCredentialAction: vi.fn(),
  revokeScimCredentialAction: vi.fn(),
  previewScimBindingAction: vi.fn(),
  approveScimBindingAction: vi.fn(),
  detachScimBindingAction: vi.fn(),
  restoreScimIdentityAction: vi.fn(),
  scimTeamsAction: vi.fn(),
  bindExistingScimUserAction: vi.fn(),
  scimDriftAction: vi.fn(),
}));
vi.mock('@/app/(app)/settings/system/scim-actions', () => actions);
const base = {
  provider: 'GENERIC',
  enabled: true,
  credentialAuthority: 'LEGACY',
  profileFields: [],
  tenantId: null,
  oidcIssuer: null,
  oidcClientId: null,
  trustedLinkEnabled: false,
  _count: { identities: 0, groups: 0 },
  credentials: [],
};
const config = {
  enabled: true,
  hasSecretToken: true,
  source: 'ENV' as const,
  legacyCredentialSource: 'ENV' as const,
  tokenHint: null,
  createdAt: null,
  updatedAt: null,
};
const preview = {
  revision: 'revision',
  additions: 0,
  removals: 0,
  protectedOwners: 1,
  services: 0,
  escalations: 0,
  adoptedMemberships: 0,
  retainedManualMemberships: 1,
  legacyCandidates: [{ id: 'member', userId: 'user' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  actions.scimOverviewAction.mockResolvedValue([
    { ...base, id: 'legacy', name: 'Legacy', legacyCredentialSource: 'ENV' },
    {
      ...base,
      id: 'other',
      name: 'Disabled directory',
      enabled: false,
      credentialAuthority: 'REGISTRY',
      credentials: [
        {
          id: 'key',
          name: 'Key',
          generation: 1,
          tokenHint: 'abcd',
          createdBy: 'admin',
          expiresAt: '2099-01-01T00:00:00Z',
          revokedAt: null,
          lastUsedAt: null,
          scopes: [],
        },
      ],
    },
  ]);
  actions.scimDirectoryAction.mockResolvedValue({
    total: 1,
    rows: [{ id: 'group', label: 'Directory group', detail: 'GROUP', time: null }],
  });
  actions.scimTeamsAction.mockResolvedValue([{ id: 'team', name: 'Operational team' }]);
  actions.previewScimBindingAction.mockResolvedValue(preview);
});
it('keeps legacy exposure visible across connections and labels disabled credentials as blocked', async () => {
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  await screen.findByRole('option', { name: 'Disabled directory (GENERIC)' });
  fireEvent.change(screen.getByLabelText('SCIM connection'), { target: { value: 'other' } });
  expect(screen.getByText(/Legacy environment authentication is active/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Security' }));
  expect(screen.getByText('Blocked · connection disabled')).toBeVisible();
  fireEvent.change(screen.getByLabelText('SCIM connection'), { target: { value: 'legacy' } });
  const create = screen.getByRole('button', { name: 'Create replacement credential' });
  expect(create).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I acknowledge that registry cutover/ }));
  expect(create).toBeEnabled();
});
it('requires a refreshed preview after legacy membership selections change', async () => {
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  await screen.findByRole('option', { name: 'Legacy (GENERIC)' });
  fireEvent.click(screen.getByRole('button', { name: 'Users & Groups' }));
  fireEvent.change(screen.getByLabelText('Resource'), { target: { value: 'groups' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Review team binding' }));
  await screen.findByRole('option', { name: 'Operational team' });
  fireEvent.change(screen.getByLabelText('Operational team'), { target: { value: 'team' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview binding' }));
  const approval = await screen.findByRole('button', { name: 'Approve this impact' });
  await waitFor(() => expect(approval).toBeEnabled());
  fireEvent.click(screen.getByRole('checkbox', { name: /Adopt directory ownership for user/ }));
  expect(approval).toBeDisabled();
  expect(screen.getByText(/Selections changed/)).toBeVisible();
  expect(actions.approveScimBindingAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview binding' }));
  await waitFor(() =>
    expect(actions.previewScimBindingAction).toHaveBeenLastCalledWith({
      groupId: 'group',
      teamId: 'team',
      adoptMemberIds: ['member'],
    })
  );
  await waitFor(() => expect(approval).toBeEnabled());
});
