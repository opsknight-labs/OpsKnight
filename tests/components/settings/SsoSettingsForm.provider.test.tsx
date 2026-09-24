import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SsoSettingsForm from '@/components/settings/SsoSettingsForm';

vi.mock('react-dom', () => ({
  useFormStatus: () => ({ pending: false }),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (fn: unknown, initialState: unknown) => [initialState, fn, false],
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/settings/RoleMappingEditor', () => ({
  default: () => <div data-testid="role-mapping-editor" />,
}));

vi.mock('@/app/(app)/settings/security/actions', () => ({
  saveOidcConfig: vi.fn(),
  validateOidcConnectionAction: vi.fn().mockResolvedValue({ isValid: true }),
}));

const commonConfig = {
  enabled: true,
  clientId: 'client-id',
  hasClientSecret: true,
  autoProvision: true,
  allowedDomains: ['example.com'],
  customScopes: null,
  roleMapping: [],
  providerLabel: '',
  profileMapping: null,
};

describe('SSO provider template persistence', () => {
  it('keeps Microsoft Entra ID selected after a real tenant issuer is saved', () => {
    render(
      <SsoSettingsForm
        initialConfig={{
          ...commonConfig,
          providerType: 'azure',
          issuer: 'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
        }}
        callbackUrl="https://app.example.com/api/auth/callback/oidc"
        hasEncryptionKey
      />
    );

    const entraButton = screen.getByRole('button', { name: 'Microsoft Entra ID' });
    const customButton = screen.getByRole('button', { name: 'Custom' });

    expect(entraButton.className).toContain('bg-primary');
    expect(customButton.className).not.toContain('bg-primary');
  });

  it('detects the provider from issuer for legacy rows without providerType', () => {
    render(
      <SsoSettingsForm
        initialConfig={{
          ...commonConfig,
          providerType: null,
          issuer: 'https://acme.okta.com/oauth2/default',
        }}
        callbackUrl="https://app.example.com/api/auth/callback/oidc"
        hasEncryptionKey
      />
    );

    expect(screen.getByRole('button', { name: 'Okta' }).className).toContain('bg-primary');
  });

  it('does not offer groups as an OAuth scope for Microsoft Entra ID', () => {
    render(
      <SsoSettingsForm
        initialConfig={{
          ...commonConfig,
          providerType: 'azure',
          issuer: 'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
        }}
        callbackUrl="https://app.example.com/api/auth/callback/oidc"
        hasEncryptionKey
      />
    );

    expect(screen.queryByRole('button', { name: '+ groups' })).not.toBeInTheDocument();
    expect(screen.getByText(/Do not request/)).toBeInTheDocument();
  });

  it('offers groups as an OAuth scope for Okta', () => {
    render(
      <SsoSettingsForm
        initialConfig={{
          ...commonConfig,
          providerType: 'okta',
          issuer: 'https://acme.okta.com/oauth2/default',
        }}
        callbackUrl="https://app.example.com/api/auth/callback/oidc"
        hasEncryptionKey
      />
    );

    expect(screen.getByRole('button', { name: '+ groups' })).toBeInTheDocument();
  });

  it('does not suggest unsupported custom scopes for Google', () => {
    render(
      <SsoSettingsForm
        initialConfig={{
          ...commonConfig,
          providerType: 'google',
          issuer: 'https://accounts.google.com',
        }}
        callbackUrl="https://app.example.com/api/auth/callback/oidc"
        hasEncryptionKey
      />
    );

    expect(screen.queryByRole('button', { name: '+ groups' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ roles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ offline_access' })).not.toBeInTheDocument();
    expect(screen.getByText(/No additional OAuth scopes are recommended/)).toBeInTheDocument();
  });
});
