import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SsoSettingsForm from '@/components/settings/SsoSettingsForm';

// Mock dependencies
vi.mock('react-dom', () => ({
  useFormStatus: () => ({ pending: false }),
}));

// Mock react useActionState
vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useActionState: (fn: any, initialState: any) => [initialState, fn, false],
  };
});

vi.mock('@/components/settings/RoleMappingEditor', () => ({
  default: () => <div data-testid="role-mapping-editor" />,
}));

vi.mock('@/app/(app)/settings/security/actions', () => ({
  saveOidcConfig: vi.fn(),
  validateOidcConnectionAction: vi.fn().mockResolvedValue({ isValid: true }),
}));

describe('SsoSettingsForm', () => {
  const defaultProps = {
    initialConfig: {
      enabled: true,
      issuer: 'https://accounts.google.com',
      clientId: 'google-client-id',
      hasClientSecret: true,
      autoProvision: true,
      allowedDomains: ['example.com'],
      customScopes: 'groups',
      roleMapping: {},
      providerLabel: '',
      profileMapping: {
        department: 'dept_claim',
        jobTitle: 'title_claim',
        avatarUrl: 'pic_claim',
      },
    },
    callbackUrl: 'https://app.example.com/api/auth/callback/oidc',
    hasEncryptionKey: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all main sections', () => {
    render(<SsoSettingsForm {...defaultProps} />);

    // Check Redesigned Card Headers
    expect(screen.getByText('Single Sign-On (OIDC)')).toBeInTheDocument();
    expect(screen.getByText('Identity Provider Credentials')).toBeInTheDocument();
    expect(screen.getByText('User Provisioning & Restrictions')).toBeInTheDocument();
    expect(screen.getByText('Claims, Scopes & Role Mapping')).toBeInTheDocument();
    expect(screen.getByText('Authorized Redirect URI (Callback URL)')).toBeInTheDocument();
    expect(screen.getByText('User Profile Attribute Claims')).toBeInTheDocument();
    expect(screen.getByText('Provider Template')).toBeInTheDocument();
    expect(screen.getByText(/Verify Before Enforcing Workspace-Wide/i)).toBeInTheDocument();
  });

  it('displays profile attribute mapping inputs correctly', () => {
    render(<SsoSettingsForm {...defaultProps} />);

    const deptInput = screen.getByDisplayValue('dept_claim');
    const titleInput = screen.getByDisplayValue('title_claim');
    const avatarInput = screen.getByDisplayValue('pic_claim');

    expect(deptInput).toBeInTheDocument();
    expect(titleInput).toBeInTheDocument();
    expect(avatarInput).toBeInTheDocument();
  });

  it('allows entering custom provider label', () => {
    render(<SsoSettingsForm {...defaultProps} />);
    const labelInput = screen.getByPlaceholderText('Auto-detect from issuer');
    fireEvent.change(labelInput, { target: { value: 'My Corp Login' } });
    expect(labelInput).toHaveValue('My Corp Login');
  });

  it('updates issuer URL when selecting a preset', () => {
    render(<SsoSettingsForm {...defaultProps} />);
    const presetButton = screen.getByRole('button', { name: /Okta/i });
    fireEvent.click(presetButton);
    const issuerInput = screen.getByPlaceholderText('https://login.company.com');
    expect(issuerInput).toHaveValue('https://{yourOktaDomain}/oauth2/default');
  });

  it('shows warning if encryption key is missing', () => {
    render(<SsoSettingsForm {...defaultProps} hasEncryptionKey={false} />);
    expect(screen.getByText(/Encryption key is required/i)).toBeInTheDocument();
  });

  it('renders RoleMappingEditor', () => {
    render(<SsoSettingsForm {...defaultProps} />);
    expect(screen.getByTestId('role-mapping-editor')).toBeInTheDocument();
  });
});
