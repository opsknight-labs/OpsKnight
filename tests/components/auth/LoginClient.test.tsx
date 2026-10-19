import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
vi.mock('@/components/auth/HelloGreeting', () => ({ default: () => <>Welcome</> }));

import LoginClient from '@/app/login/LoginClient';

function renderLogin(options: { ssoEnabled: boolean; localAuthEnabled: boolean }) {
  return render(
    <LoginClient
      callbackUrl="/"
      ssoEnabled={options.ssoEnabled}
      ssoProviderType="okta"
      ssoProviderLabel="Company SSO"
      localAuthEnabled={options.localAuthEnabled}
    />
  );
}

describe('desktop login authentication methods', () => {
  it('keeps SSO available when local credentials are disabled', () => {
    renderLogin({ ssoEnabled: true, localAuthEnabled: false });

    expect(screen.getByRole('button', { name: 'Sign in with Company SSO' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('you@company.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/^or$/i)).not.toBeInTheDocument();
  });

  it('shows both methods and a divider when both are enabled', () => {
    renderLogin({ ssoEnabled: true, localAuthEnabled: true });

    expect(screen.getByRole('button', { name: 'Sign in with Company SSO' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
  });

  it('shows an explicit error when no authentication method is available', () => {
    renderLogin({ ssoEnabled: false, localAuthEnabled: false });

    expect(screen.getByRole('alert')).toHaveTextContent('No authentication method is available');
  });

  it('renders a high-contrast dismissible X button on error banner and clears error on click', () => {
    render(
      <LoginClient
        callbackUrl="/"
        ssoEnabled={true}
        localAuthEnabled={true}
        errorCode="CredentialsSignin"
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password');

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss error' });
    expect(dismissBtn).toBeInTheDocument();
    expect(dismissBtn.className).toContain('dark:border-red-500/50');
    expect(dismissBtn.className).toContain('dark:text-red-100');
    expect(dismissBtn.className).toContain('dark:hover:text-white');

    fireEvent.click(dismissBtn);
    expect(screen.queryByText('Invalid email or password')).not.toBeInTheDocument();
  });

  it('renders a high-contrast dismissible X button on password set success alert', () => {
    render(
      <LoginClient callbackUrl="/" ssoEnabled={true} localAuthEnabled={true} passwordSet={true} />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Password set successfully');

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss message' });
    expect(dismissBtn).toBeInTheDocument();
    expect(dismissBtn.className).toContain('dark:border-white/25');
    expect(dismissBtn.className).toContain('dark:text-white');

    fireEvent.click(dismissBtn);
    expect(screen.queryByText('Password set successfully')).not.toBeInTheDocument();
  });
});
