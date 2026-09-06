import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SsoButton from '@/components/auth/SsoButton';

// Mock Spinner
vi.mock('@/components/ui/Spinner', () => ({
  default: () => <div data-testid="spinner">Spinner</div>,
}));

describe('SsoButton', () => {
  it('renders with default label and custom style when no props provided', () => {
    render(<SsoButton onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Continue with SSO');
    // Basic check for custom style (icon exists)
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('renders Google branding correctly', () => {
    render(<SsoButton providerType="google" onClick={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Continue with Google');
    expect(button).toHaveAttribute('aria-label', 'Sign in with Google');
  });

  it('renders Okta branding correctly', () => {
    render(<SsoButton providerType="okta" onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Continue with Okta');
  });

  it('renders Azure branding correctly', () => {
    render(<SsoButton providerType="azure" onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Continue with Microsoft');
  });

  it('renders provider label override', () => {
    render(<SsoButton providerType="google" providerLabel="My Company Login" onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveTextContent('Continue with My Company Login');
  });

  it('shows loading state', () => {
    render(<SsoButton loading={true} onClick={vi.fn()} />);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<SsoButton onClick={handleClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<SsoButton disabled={true} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
