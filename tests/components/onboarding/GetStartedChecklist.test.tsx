import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import GetStartedChecklist from '@/components/onboarding/GetStartedChecklist';
import { buildOnboardingSteps } from '@/lib/onboarding';

const partial = buildOnboardingSteps({
  services: 1,
  integrations: 0,
  schedules: 0,
  policies: 0,
  users: 1,
});
const all = buildOnboardingSteps({
  services: 1,
  integrations: 1,
  schedules: 1,
  policies: 1,
  users: 2,
});

describe('GetStartedChecklist', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows progress and links, and persists dismissal', () => {
    const { unmount } = render(<GetStartedChecklist steps={partial} />);
    expect(screen.getByText('1 of 5 steps complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect an integration/ })).toHaveAttribute(
      'href',
      '/settings/integrations'
    );
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('region')).toBeNull();
    unmount();
    render(<GetStartedChecklist steps={partial} />);
    expect(screen.queryByText(/Get started/)).toBeNull();
  });

  it('hides itself when everything is done', () => {
    render(<GetStartedChecklist steps={all} />);
    expect(screen.queryByText(/Get started/)).toBeNull();
  });
});
