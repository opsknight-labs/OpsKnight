import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ComplianceClientTabs from '@/components/settings/compliance/ComplianceClientTabs';
import type { ComplianceControl } from '@/lib/compliance/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

describe('ComplianceClientTabs', () => {
  const mockFrameworks = [
    {
      id: 'SOC2' as const,
      title: 'SOC 2 Type II',
      scope: 'Security, Availability, Confidentiality trust services criteria',
      source: 'https://www.aicpa.org',
      counts: { IMPLEMENTED: 8, PARTIAL: 2, MISSING: 0 },
    },
    {
      id: 'ISO27001' as const,
      title: 'ISO/IEC 27001:2022',
      scope: 'Information security management system requirements',
      source: 'https://www.iso.org',
      counts: { IMPLEMENTED: 6, PARTIAL: 1, MISSING: 1 },
    },
  ];

  const mockControls: ComplianceControl[] = [
    {
      id: 'SEC-01',
      title: 'Multi-Factor Authentication',
      description: 'Enforces multi-factor authentication on administrative sessions.',
      status: 'IMPLEMENTED',
      owner: 'OPERATOR',
      frameworks: ['SOC2', 'ISO27001'],
      implementation: 'Enforced for all admin sessions via TOTP/WebAuthn.',
      gaps: [],
      evidence: ['src/lib/auth/mfa.ts'],
    },
    {
      id: 'SEC-02',
      title: 'Secrets Management & Rotation',
      description: 'Encryption and lifecycle for secrets.',
      status: 'PARTIAL',
      owner: 'OPERATOR',
      frameworks: ['SOC2'],
      implementation: 'AES-256 encrypted in transit and rest.',
      gaps: ['Automated 90-day rotation pipeline pending.'],
      evidence: ['src/lib/vault.ts'],
    },
    {
      id: 'CRA-01',
      title: 'Software Bill of Materials (SBOM)',
      description: 'SBOM export pipeline.',
      status: 'IMPLEMENTED',
      owner: 'MAINTAINER',
      frameworks: ['CRA'],
      implementation: 'Automated SPDX export on release tag.',
      gaps: [],
      evidence: ['.github/workflows/sbom.yml'],
    },
  ];

  const mockPersonalDataRegistry = [
    {
      domain: 'User Profile & Identity',
      models: ['User'],
      fields: ['name', 'email'],
      classifications: ['PERSONAL'] as const,
      locations: ['DATABASE'] as const,
      discoverable: 'COUNTED' as const,
      purpose: ['Authentication', 'Session Security'],
      retention: { current: 'Active account duration + 30 days', target: '90 days' },
      notes: [],
    },
  ];

  const defaultProps = {
    overall: { IMPLEMENTED: 15, PARTIAL: 3, MISSING: 2 },
    frameworks: mockFrameworks,
    controls: mockControls,
    personalDataRegistry: mockPersonalDataRegistry,
    privacyData: {
      users: [{ id: 'user-1', name: 'Alice Admin', email: 'alice@example.com', status: 'ACTIVE' }],
      userCount: 1,
      selectedUser: null,
      discovery: null,
      query: '',
      page: 1,
      pageCount: 1,
    },
  };

  it('renders canonical DetailHeroBanner with title, badges, stats capsules, and disclaimer alert', () => {
    render(<ComplianceClientTabs {...defaultProps} />);

    // Banner Tag & Title
    expect(screen.getByText('Security Posture & Compliance Frameworks')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Security & Compliance' })
    ).toBeInTheDocument();

    // Badges (adhering to readiness percentage without "compliant" or "score")
    expect(screen.getByText(/75% Implemented/i)).toBeInTheDocument();
    expect(screen.getByText('Enterprise Governance')).toBeInTheDocument();

    // 4 Stats capsules
    expect(screen.getByText('Implemented')).toBeInTheDocument();
    expect(screen.getByText('15 (75%)')).toBeInTheDocument();

    expect(screen.getByText('Partial Controls')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    expect(screen.getByText('Missing / Gaps')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);

    expect(screen.getByText('Frameworks')).toBeInTheDocument();
    expect(screen.getByText('2 Frameworks')).toBeInTheDocument();

    // Disclaimer alert banner
    expect(screen.getAllByText(/Read-only readiness diagnostics/i).length).toBeGreaterThanOrEqual(
      1
    );
    expect(
      screen.getByText(/not constitute a formal audit certification or legal conclusions/i)
    ).toBeInTheDocument();

    // Action links
    expect(screen.getByRole('link', { name: /Audit Log/i })).toHaveAttribute('href', '/audit');
    expect(screen.getByRole('link', { name: /Settings Hub/i })).toHaveAttribute(
      'href',
      '/settings'
    );
  });

  it('allows navigating between sub-tabs', () => {
    render(<ComplianceClientTabs {...defaultProps} />);

    // Tab 1: Frameworks Overview (active by default)
    expect(screen.getByText('SOC 2 Type II')).toBeInTheDocument();
    expect(screen.getByText('ISO/IEC 27001:2022')).toBeInTheDocument();

    // Switch to Security Controls
    fireEvent.click(screen.getByRole('button', { name: /Security Controls/i }));
    expect(screen.getByText('Multi-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByText('Secrets Management & Rotation')).toBeInTheDocument();
    expect(screen.getByText(/Remaining Gap/i)).toBeInTheDocument();

    // Switch to Privacy & DSR
    fireEvent.click(screen.getByRole('button', { name: /Privacy & DSR/i }));
    expect(screen.getByText('Personal Data Registry')).toBeInTheDocument();
    expect(screen.getByText('Subject Discovery & DSR')).toBeInTheDocument();
    expect(screen.getByText('User Profile & Identity')).toBeInTheDocument();

    // Switch to CRA Readiness
    fireEvent.click(screen.getByRole('button', { name: /CRA Readiness/i }));
    expect(screen.getByText('Software Bill of Materials (SBOM)')).toBeInTheDocument();

    // Switch to Evidence Catalog
    fireEvent.click(screen.getByRole('button', { name: /Evidence Catalog/i }));
    expect(screen.getByText('Verified Evidence Catalog')).toBeInTheDocument();
    expect(screen.getByText('src/lib/auth/mfa.ts')).toBeInTheDocument();
  });
});
