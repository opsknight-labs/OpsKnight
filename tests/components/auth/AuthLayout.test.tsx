import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthLayout } from '@/components/auth/AuthLayout';

// Regression guard: the mobile decorative banner used to render unconditionally
// at up to 150px tall on every phone width, pushing the actual auth form
// (SSO/email/password/trusted-device/forgot-password/sign-in) further down
// the viewport. It must now be hidden by default and only appear from the
// `sm` breakpoint up (phones get zero decorative banner; desktop uses the
// full side animation instead, gated separately by `lg:flex`).
describe('AuthLayout', () => {
  it('hides the mobile banner by default and only shows it at sm and up', () => {
    render(
      <AuthLayout>
        <div>content</div>
      </AuthLayout>
    );

    const banner = document.querySelector('.border-b.border-\\[\\#1a202c\\].sm\\:block');
    expect(banner).toBeTruthy();
    expect(banner?.className).toContain('hidden');
    expect(banner?.className).toContain('sm:block');
    expect(banner?.className).toContain('lg:hidden');
    // No unconditional fixed banner height below `sm` anymore.
    expect(banner?.className).not.toMatch(/^h-\[|(?:^|\s)h-\[clamp/);
  });

  it('renders the desktop side animation gated to lg and up', () => {
    render(
      <AuthLayout>
        <div>content</div>
      </AuthLayout>
    );

    const sideAnimation = document.querySelector('section.lg\\:flex');
    expect(sideAnimation).toBeTruthy();
    expect(sideAnimation?.className).toContain('hidden');
  });

  it('renders no banner at all when showAnimation is false', () => {
    render(
      <AuthLayout showAnimation={false}>
        <div>content</div>
      </AuthLayout>
    );

    expect(document.querySelector('.sm\\:block.lg\\:hidden')).toBeNull();
  });

  it('renders provided children', () => {
    render(
      <AuthLayout>
        <div data-testid="auth-form">form</div>
      </AuthLayout>
    );
    expect(screen.getByTestId('auth-form')).toBeInTheDocument();
  });
});
