import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComplianceControlCenter } from '@/components/settings/compliance/control-center';
import type { ComplianceControlCenterOverview } from '@/lib/compliance/control-center/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

describe('ComplianceControlCenter Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockOverview: ComplianceControlCenterOverview = {
    generatedAt: new Date('2026-09-20T00:00:00Z').toISOString(),
    runtime: {
      total: 6,
      implemented: 4,
      partial: 1,
      actionRequired: 1,
      unverified: 0,
    },
    evidence: {
      records: 12,
      verifiedRecords: 12,
      integrityMismatches: 0,
      integritySample: {
        checkedRecords: 12,
        validRecords: 12,
        mismatches: 0,
      },
    },
    frameworks: {
      count: 6,
      activeRequirements: 24,
      futureRequirements: 8,
      supersededRequirements: 4,
    },
    attention: [
      {
        id: 'att-1',
        controlId: 'SEC-ENC-001',
        controlTitle: 'Stored secret encryption',
        severity: 'MEDIUM',
        type: 'ACTION_REQUIRED',
        reason: 'Key rotation pending for version 2',
        actionLabel: 'Remediate in Operations',
        actionType: 'VIEW_OPERATIONS',
      },
    ],
    controls: [
      {
        controlId: 'SEC-ENC-001',
        title: 'Stored secret encryption',
        description: 'Envelope encryption with AES-256-GCM',
        category: 'Cryptography',
        assessmentMode: 'RUNTIME',
        owner: 'MAINTAINER',
        legacyStatus: 'PARTIAL',
        runtime: {
          status: 'PARTIAL',
          summary: 'KMS key v2 active; legacy secrets pending re-wrap',
          evaluatedAt: new Date().toISOString(),
          validUntil: null,
          evaluatorId: 'encryption.at-rest',
          evaluatorVersion: '2.0.0',
          isVersionCurrent: true,
        },
        evidence: {
          count: 2,
          latestObservedAt: new Date().toISOString(),
          latestIntegrity: 'VERIFIED',
          integrity: 'VERIFIED',
          latestDigest: 'a'.repeat(64),
        },
        frameworkMappings: [
          {
            framework: 'GDPR',
            requirementId: 'GDPR-32-1-A',
            reference: 'Article 32(1)(a)',
            title: 'Pseudonymisation and encryption of personal data',
            lifecycle: 'ACTIVE',
            relationship: 'TECHNICAL_EVIDENCE',
            evidenceExpectation: 'RUNTIME',
          },
        ],
        gaps: ['Legacy v1 secrets must be migrated'],
      },
      {
        controlId: 'SEC-AUTH-001',
        title: 'OIDC authentication',
        description: 'Federated identity authentication',
        category: 'Identity',
        assessmentMode: 'REPOSITORY',
        owner: 'MAINTAINER',
        legacyStatus: 'IMPLEMENTED',
        evidence: {
          count: 0,
          latestObservedAt: null,
          latestIntegrity: 'NONE',
          integrity: 'NONE',
        },
        frameworkMappings: [],
        gaps: [],
      },
    ],
    retentionPolicy: {
      logRetentionDays: 365,
      incidentRetentionDays: 730,
      alertRetentionDays: 365,
      metricsRetentionDays: 365,
      privacyRequestRetentionDays: 730,
    },
  };

  const mockFrameworks = [
    {
      id: 'GDPR' as const,
      title: 'General Data Protection Regulation',
      scope: 'Personal data processing in EU/EEA',
      source: 'https://eur-lex.europa.eu',
      version: '2016/679',
      summaryView: {
        mappedRequirementsCount: 6,
        mappedControlsCount: 4,
        runtimeBackedCount: 3,
        repositoryBackedCount: 1,
        operatorDependencyCount: 2,
        organizationalDependencyCount: 3,
        futureRequirementsCount: 0,
      },
    },
  ];

  const mockCapabilities = {
    canEvaluate: true,
    canReadEvidence: true,
    canReadEncryption: true,
    canManageEncryption: true,
    canReadPrivacy: true,
    canReadRetention: true,
  };

  it('renders unified header with title, tabs, and runtime metrics', () => {
    render(
      <ComplianceControlCenter
        initialData={mockOverview}
        frameworks={mockFrameworks}
        capabilities={mockCapabilities}
      />
    );

    expect(screen.getByText('Compliance Control Center')).toBeInTheDocument();
    expect(screen.getByText('Runtime Implemented: 4/6')).toBeInTheDocument();

    // Check all 5 tabs exist
    expect(screen.getByRole('button', { name: /^Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Controls/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Frameworks/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Evidence Ledger/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Operations$/i })).toBeInTheDocument();
  });

  it('renders overview with factual metrics and attention required item', () => {
    render(
      <ComplianceControlCenter
        initialData={mockOverview}
        frameworks={mockFrameworks}
        capabilities={mockCapabilities}
      />
    );

    expect(screen.getByText('Continuous Compliance Posture')).toBeInTheDocument();
    expect(screen.getByText('Attention Required')).toBeInTheDocument();
    expect(screen.getByText('Stored secret encryption')).toBeInTheDocument();
    expect(screen.getByText('Key rotation pending for version 2')).toBeInTheDocument();
    expect(screen.getByText('Architectural Scope & Non-Certification Notice')).toBeInTheDocument();
  });

  it('does NOT contain user search, emails, or personal data DSR forms', () => {
    const { container } = render(
      <ComplianceControlCenter
        initialData={mockOverview}
        frameworks={mockFrameworks}
        capabilities={mockCapabilities}
      />
    );

    expect(screen.queryByPlaceholderText(/Search users/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Subject Data Discovery/i)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('@example.com');
  });

  it('switches to Controls tab and displays control list with search filter', async () => {
    render(
      <ComplianceControlCenter
        initialData={mockOverview}
        frameworks={mockFrameworks}
        capabilities={mockCapabilities}
      />
    );

    const controlsTabBtn = screen.getByRole('button', { name: /^Controls/i });
    fireEvent.click(controlsTabBtn);

    expect(screen.getByPlaceholderText(/Search by ID, title, description/i)).toBeInTheDocument();
    expect(screen.getByText('SEC-ENC-001')).toBeInTheDocument();
    expect(screen.getByText('SEC-AUTH-001')).toBeInTheDocument();
  });

  it('switches to Operations tab and displays Encryption Lifecycle and Privacy portal boundary', () => {
    render(
      <ComplianceControlCenter
        initialData={mockOverview}
        frameworks={mockFrameworks}
        capabilities={mockCapabilities}
      />
    );

    const opsTabBtn = screen.getByRole('button', { name: /^Operations$/i });
    fireEvent.click(opsTabBtn);

    expect(screen.getByText(/Cryptographic Envelope & Secret Lifecycle/i)).toBeInTheDocument();
    expect(screen.getByText(/Privacy Requests & DSR Processing Portal/i)).toBeInTheDocument();
    expect(screen.getByText(/Data Retention & Disposal/i)).toBeInTheDocument();
  });

  it('triggers evaluate controls on button click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, count: 6 }),
    });
    global.fetch = fetchMock;

    render(
      <ComplianceControlCenter
        initialData={mockOverview}
        frameworks={mockFrameworks}
        capabilities={mockCapabilities}
      />
    );

    const evalBtn = screen.getByRole('button', { name: /Evaluate Runtime Controls/i });
    fireEvent.click(evalBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/compliance/evaluations',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
