import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(app)/settings/actions', () => ({ updateProfile: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock('@/hooks/useUserAvatar', () => ({ useAvatarUpdater: () => vi.fn() }));

import ProfileForm from '@/components/settings/ProfileForm';

describe('profile fields managed elsewhere', () => {
  it('locks directory-managed fields and says where to change them', () => {
    render(
      <ProfileForm
        name="Priya Shah"
        email="priya@acme.test"
        role="RESPONDER"
        memberSince="Jan 1, 2026"
        department="Platform"
        jobTitle="SRE"
        ssoLinked
        managedFields={{ department: 'your company directory (Okta)' }}
      />
    );
    expect(screen.getByLabelText(/Department/)).toHaveAttribute('readonly');
    expect(screen.getByText(/Managed by your company directory \(Okta\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Job Title/)).not.toHaveAttribute('readonly');
    expect(screen.getByText('Single sign-on')).toBeInTheDocument();
  });
});
