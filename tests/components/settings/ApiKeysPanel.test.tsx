/* eslint-disable security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { API_SCOPE_REGISTRY } from '@/lib/api-scope-registry';
import ApiKeysPanel, { type ApiKey } from '@/components/settings/ApiKeysPanel';
import { revokeApiKey } from '@/app/(app)/settings/actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

// Mock server actions
vi.mock('@/app/(app)/settings/actions', () => ({
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

const mockKeys: ApiKey[] = [
  {
    id: 'key-1',
    name: 'Datadog Ingestion',
    prefix: 'ops_live_d7a',
    scopes: ['events:write', 'incidents:read'],
    createdAt: 'Sep 1, 2026',
    lastUsedAt: 'Sep 1, 2026',
    revokedAt: null,
    expiresAt: 'Nov 30, 2026',
    expired: false,
    ownerEmail: 'admin@example.com',
  },
  {
    id: 'key-2',
    name: 'GitHub CI Pipeline',
    prefix: 'ops_live_83b',
    scopes: ['incidents:write'],
    createdAt: 'Aug 15, 2026',
    lastUsedAt: null,
    revokedAt: 'Aug 20, 2026',
    expiresAt: null,
    expired: false,
    ownerEmail: 'developer@example.com',
  },
  {
    id: 'key-3',
    name: 'Old Testing Key',
    prefix: 'ops_live_12c',
    scopes: ['services:read'],
    createdAt: 'Jan 10, 2026',
    lastUsedAt: 'Jan 15, 2026',
    revokedAt: null,
    expiresAt: 'Feb 10, 2026',
    expired: true,
    ownerEmail: 'qa@example.com',
  },
];

const title = (scope: keyof typeof API_SCOPE_REGISTRY) => API_SCOPE_REGISTRY[scope].title;

describe('ApiKeysPanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all API keys with names, prefixes, scopes, and statuses', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    expect(screen.getByText('Datadog Ingestion')).toBeDefined();
    expect(screen.getByText('ops_live_d7a...')).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('Active')).toBeDefined();

    expect(screen.getByText('GitHub CI Pipeline')).toBeDefined();
    expect(screen.getByText('ops_live_83b...')).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('Revoked')).toBeDefined();

    expect(screen.getByText('Old Testing Key')).toBeDefined();
    expect(screen.getByText('ops_live_12c...')).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('Expired')).toBeDefined();
  });

  it('uses the friendly machine owner label without exposing its internal email', () => {
    render(<ApiKeysPanel keys={[{ ...mockKeys[0], ownerLabel: 'Production Deployment', ownerEmail: 'sa_1792166039840_4eaf8d76@serviceaccount.opsknight.local' }]} canCreateWriteKeys={true} />);
    expect(screen.getByText('Production Deployment')).toBeDefined();
    expect(screen.queryByText(/@serviceaccount\.opsknight\.local/)).toBeNull();
  });

  it('sends search and status to the server as URL params instead of filtering in the browser', () => {
    const { container } = render(
      <ApiKeysPanel
        keys={mockKeys}
        canCreateWriteKeys={true}
        inventory={{ q: 'datadog', status: 'ACTIVE', hasCursor: false, nextCursor: null }}
      />
    );
    const form = container.querySelector('form[aria-label="Filter API keys"]') as HTMLFormElement;
    expect(form.method).toBe('get');
    expect((form.querySelector('input[name="tab"]') as HTMLInputElement).value).toBe('api-keys');
    expect((form.querySelector('input[name="kq"]') as HTMLInputElement).value).toBe('datadog');
    expect((form.querySelector('select[name="kstatus"]') as HTMLSelectElement).value).toBe('ACTIVE');
    // Every row the server returned is shown; nothing is hidden client-side.
    expect(screen.getByText('Datadog Ingestion')).toBeDefined();
    expect(screen.getByText('GitHub CI Pipeline')).toBeDefined();
  });

  it('pages through keys with a cursor and keeps the active filters', () => {
    render(
      <ApiKeysPanel
        keys={mockKeys}
        canCreateWriteKeys={true}
        inventory={{ q: 'ci', status: 'REVOKED', hasCursor: true, nextCursor: 'cur-1', total: 90 }}
      />
    );
    const older = screen.getByRole('link', { name: /older keys/i }).getAttribute('href') ?? '';
    expect(older).toContain('tab=api-keys');
    expect(older).toContain('kcursor=cur-1');
    expect(older).toContain('kq=ci');
    expect(older).toContain('kstatus=REVOKED');
    expect(screen.getByRole('link', { name: /newest/i })).toBeDefined();
    expect(screen.getByText(/90 keys match/)).toBeDefined();
  });

  it('opens create API key modal dialog on button click', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} isAdmin={true} />);

    const generateButtons = screen.getAllByRole('button', { name: /generate api key/i });
    fireEvent.click(generateButtons[0]);

    expect(screen.getByText('Generate New API Key')).toBeDefined();
    expect(screen.getByLabelText(/key name \/ client identifier \*/i)).toBeDefined();
    expect(screen.getByLabelText(/expiration duration/i)).toBeDefined();
    expect(screen.getByText(title('response-policy:read'))).toBeDefined();
    expect(screen.getByText(title('response-policy:write'))).toBeDefined();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('style')).toContain('max-width: 72rem');
    expect(dialog.className).toContain('sm:w-[94vw]');
  });

  it('keeps response-policy read available for admins while hiding write scope without write access', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={false} isAdmin={true} />);
    fireEvent.click(screen.getAllByRole('button', { name: /generate api key/i })[0]);
    expect(screen.getByText(title('response-policy:read'))).toBeDefined();
    expect(screen.queryByText(title('response-policy:write'))).toBeNull();
  });

  it('offers newly supported user administration scope for explicit review', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} isAdmin={true} />);
    fireEvent.click(screen.getAllByRole('button', { name: /generate api key/i })[0]);
    expect(screen.getByText(title('runbooks:write'))).toBeVisible();
    expect(screen.getByText(title('runbooks:publish'))).toBeVisible();
    expect(screen.getByText(title('users:write'))).toBeVisible();
  });

  it('hides administrative scopes for non-admins, following the registry', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} isAdmin={false} />);
    fireEvent.click(screen.getAllByRole('button', { name: /generate api key/i })[0]);
    // The /api/v1 response-policy API requires ADMIN for reads too, so neither scope is offered.
    expect(screen.queryByText(title('response-policy:read'))).toBeNull();
    expect(screen.queryByText(title('response-policy:write'))).toBeNull();
    expect(screen.queryByText(title('admin:manage'))).toBeNull();
    expect(screen.queryByText(title('service-accounts:read'))).toBeNull();
  });


  it('uses the standard confirmation dialog and revokes the selected key', async () => {
    vi.mocked(revokeApiKey).mockResolvedValue(undefined);

    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByText('Revoke API Key?')).toBeDefined();
    expect(
      screen.getByText(/applications, webhooks, or pipelines using this token/i)
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Key' }));

    await waitFor(() => {
      expect(revokeApiKey).toHaveBeenCalledTimes(1);
    });

    const formData = vi.mocked(revokeApiKey).mock.calls[0][0] as FormData;
    expect(formData.get('keyId')).toBe('key-1');
  });

  it('renders developer API quickstart code examples', () => {
    render(<ApiKeysPanel keys={mockKeys} canCreateWriteKeys={true} />);

    expect(screen.getByText('Developer API Quickstart')).toBeDefined();
    expect(screen.getByText('cURL')).toBeDefined();
    expect(screen.getByText('Node.js / Fetch')).toBeDefined();
    expect(screen.getByText('Python (requests)')).toBeDefined();
  });

  it('renders empty state when no keys exist', () => {
    render(<ApiKeysPanel keys={[]} canCreateWriteKeys={true} />);

    expect(screen.getByText('No API keys configured')).toBeDefined();
  });
});

describe('one-time secret banner', () => {
  it('stays until the user confirms storage, then removes the secret from the page', async () => {
    const { default: OneTimeSecretBanner } = await import(
      '@/components/settings/OneTimeSecretBanner'
    );
    const onDismiss = vi.fn();
    const { rerender } = render(
      <OneTimeSecretBanner
        title="Key generated"
        badge="Secret"
        secret="ok_test_super_secret_value_123"
        description="Copy it now."
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByTestId('one-time-secret').textContent).toBe('ok_test_super_secret_value_123');
    const dismiss = screen.getByRole('button', { name: /dismiss and clear/i }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /i have stored this secret/i }));
    expect(dismiss.disabled).toBe(false);
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // The parent drops the secret on dismiss; nothing remains in the document.
    rerender(<div />);
    expect(document.body.textContent).not.toContain('ok_test_super_secret_value_123');
  });
});
