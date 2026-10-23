import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  scimTeamPageAction: vi.fn(),
  scimConnectionPageAction: vi.fn(),
  scimCredentialPageAction: vi.fn(),
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
  transfers: 0,
  sessionInvalidations: 0,
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
  actions.scimTeamPageAction.mockResolvedValue({
    rows: [{ id: 'team', name: 'Operational team' }],
    total: 1,
    selected: null,
  });
  actions.scimConnectionPageAction.mockResolvedValue({ rows: [], total: 0 });
  actions.scimCredentialPageAction.mockResolvedValue({
    rows: [
      {
        id: 'key',
        name: 'Key',
        generation: 1,
        tokenHint: 'hint',
        scopes: [],
        expiresAt: '2099-01-01',
        revokedAt: null,
        createdBy: 'admin',
        lastUsedAt: null,
      },
    ],
    total: 1,
  });
  actions.previewScimBindingAction.mockResolvedValue(preview);
});
it('keeps legacy exposure visible across connections and labels disabled credentials as blocked', async () => {
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  await screen.findByRole('option', { name: 'Disabled directory (GENERIC)' });
  fireEvent.change(screen.getByLabelText('SCIM connection'), { target: { value: 'other' } });
  expect(screen.getByText(/Legacy environment authentication is active/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Security' }));
  expect(await screen.findByText('Blocked · connection disabled')).toBeVisible();
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

it('keeps connection inputs disabled until their initial defaults are loaded', async () => {
  let resolveOverview!: (value: unknown) => void;
  actions.scimOverviewAction.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveOverview = resolve;
      })
  );
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  expect(screen.getByLabelText('Connection name')).toBeDisabled();
  expect(screen.getByLabelText('Save as a new connection')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save connection' })).toBeDisabled();
  await act(async () =>
    resolveOverview([
      { ...base, id: 'legacy', name: 'Loaded connection', legacyCredentialSource: 'ENV' },
    ])
  );
  expect(screen.getByLabelText('Connection name')).toBeEnabled();
  expect(screen.getByLabelText('Connection name')).toHaveValue('Loaded connection');
  fireEvent.click(screen.getByLabelText('Save as a new connection'));
  expect(screen.getByLabelText('Save as a new connection')).toBeChecked();
});

it('does not keep connection editing blocked by a cancelled directory request', async () => {
  actions.scimDirectoryAction.mockImplementationOnce(() => new Promise(() => {}));
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  await screen.findByRole('option', { name: 'Legacy (GENERIC)' });
  fireEvent.click(screen.getByRole('button', { name: 'Users & Groups' }));
  await waitFor(() => expect(actions.scimDirectoryAction).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  expect(screen.getByLabelText('Connection name')).toBeEnabled();
  expect(screen.queryByText('Loading provisioning data…')).not.toBeInTheDocument();
});

it('finds connection 101 and keeps its loaded selection when browsing another page', async () => {
  actions.scimConnectionPageAction.mockImplementation(async ({ page }) => ({
    total: 101,
    rows: page === 5 ? [{ id: 'connection-101', name: 'Connection 101', provider: 'GENERIC' }] : [],
  }));
  actions.scimOverviewAction.mockImplementation(async ({ selectedId }) => [
    { ...base, id: 'legacy', name: 'Legacy', legacyCredentialSource: 'ENV' },
    ...(selectedId === 'connection-101'
      ? [{ ...base, id: selectedId, name: 'Connection 101', legacyCredentialSource: null }]
      : []),
  ]);
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  await screen.findByText('Connection page 1 · 101 records');
  for (let index = 0; index < 4; index++)
    fireEvent.click(screen.getByRole('button', { name: 'Next connections' }));
  await screen.findByRole('option', { name: 'Connection 101 (GENERIC)' });
  fireEvent.change(screen.getByLabelText('SCIM connection'), {
    target: { value: 'connection-101' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Connection name')).toHaveValue('Connection 101')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous connections' }));
  await screen.findByText('Connection page 4 · 101 records');
  expect(screen.getByLabelText('SCIM connection')).toHaveValue('connection-101');
});

it('pages to and revokes an older active credential', async () => {
  const key = {
    name: 'Older active key',
    generation: 1,
    tokenHint: 'old',
    scopes: [],
    expiresAt: '2099-01-01',
    revokedAt: null,
    createdBy: 'admin',
    lastUsedAt: null,
  };
  actions.scimCredentialPageAction.mockImplementation(async ({ page, status }) => ({
    total: 26,
    rows: [
      {
        ...key,
        id: page === 2 ? 'oldest' : 'newer',
        name:
          status === 'revoked'
            ? 'Revoked history'
            : page === 2
              ? 'Oldest active credential'
              : 'Newer credential',
      },
    ],
  }));
  actions.revokeScimCredentialAction.mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    await screen.findByText(/Newer credential/);
    fireEvent.click(screen.getByRole('button', { name: 'Next credentials' }));
    await screen.findByText(/Oldest active credential/);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential' }));
    await waitFor(() => expect(actions.revokeScimCredentialAction).toHaveBeenCalledWith('oldest'));
    fireEvent.change(screen.getByLabelText('Credential status'), { target: { value: 'revoked' } });
    await screen.findByText(/Revoked history/);
    expect(actions.scimCredentialPageAction).toHaveBeenCalledWith({
      connectorId: 'legacy',
      page: 1,
      status: 'revoked',
    });
  } finally {
    confirm.mockRestore();
  }
});

it('pages drift diagnostics and retains a repair team outside the first team page', async () => {
  actions.scimDriftAction.mockImplementation(async ({ page }) =>
    page === 1
      ? Array.from({ length: 25 }, (_, index) => ({
          groupId: `group-${index}`,
          group: `Group ${index}`,
          teamId: `team-${index}`,
          team: `Team ${index}`,
          missingMembers: 0,
          unexpectedDirectoryGrants: 0,
          independentManualMembers: 0,
        }))
      : [
          {
            groupId: 'later-group',
            group: 'Later group',
            teamId: 'later-team',
            team: 'Later team',
            missingMembers: 1,
            unexpectedDirectoryGrants: 0,
            independentManualMembers: 0,
          },
        ]
  );
  actions.scimTeamPageAction.mockImplementation(async ({ selectedId, page }) => ({
    total: 26,
    rows:
      page === 2
        ? [{ id: 'later-team', name: 'Later team' }]
        : [{ id: 'first-team', name: 'First team' }],
    selected: selectedId === 'later-team' ? { id: 'later-team', name: 'Later team' } : null,
  }));
  render(<ScimSettingsSection initialConfig={config} tenantUrl="https://ops.test/api/scim/v2" />);
  fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare local memberships' }));
  await screen.findByText('Drift page 1');
  fireEvent.click(screen.getByRole('button', { name: 'Next drift' }));
  await screen.findByText('Drift page 2');
  fireEvent.click(screen.getByRole('button', { name: 'Preview repair' }));
  await screen.findByRole('option', { name: 'Later team' });
  expect(screen.getByLabelText('Operational team')).toHaveValue('later-team');
  fireEvent.click(screen.getByRole('button', { name: 'Next teams' }));
  await screen.findByText('Team page 2 · 26 records');
  expect(screen.getByLabelText('Operational team')).toHaveValue('later-team');
});
