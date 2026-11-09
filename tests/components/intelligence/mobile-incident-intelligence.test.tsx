import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const views = vi.hoisted(() => ({
  similar: vi.fn(),
  response: vi.fn(),
  triage: vi.fn(),
  actor: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: views.actor }));
vi.mock('@/lib/intelligence/similarity/view', () => ({
  getSimilarIncidentsForActor: views.similar,
}));
vi.mock('@/lib/intelligence/response/view', () => ({
  getResponseIntelligenceForActor: views.response,
}));
vi.mock('@/lib/intelligence/triage/view', () => ({ getTriageForActor: views.triage }));
vi.mock('@/app/(app)/incidents/[id]/triage-actions', () => ({ decideTriage: vi.fn() }));

import {
  MobileResponseSection,
  MobileSimilarSection,
  MobileTriageSection,
} from '@/components/incident/mobile/MobileIncidentIntelligence';

beforeEach(() => {
  vi.clearAllMocks();
  views.actor.mockResolvedValue({ userId: 'u1', role: 'RESPONDER' });
});

describe('mobile incident intelligence sections', () => {
  it('shows at most three similar incidents, linking to the mobile incident page with 44px targets', async () => {
    views.similar.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        incidentId: `inc-${i}`,
        title: `Similar ${i}`,
        serviceName: 'Checkout',
        createdAt: new Date('2026-11-01T00:00:00Z'),
        status: 'RESOLVED',
        matchPercent: 80 - i,
        resolutionSummary: i === 0 ? 'Restarted the pool' : null,
      }))
    );
    render(await MobileSimilarSection({ incidentId: 'inc-x' }));
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', '/m/incidents/inc-0');
    expect(links[0].className).toContain('min-h-11');
    expect(screen.getByText('Fixed by: Restarted the pool')).toBeInTheDocument();
    expect(views.similar).toHaveBeenCalledWith('inc-x', { userId: 'u1', role: 'RESPONDER' });
  });

  it('renders nothing when the viewer cannot read suggestions, when empty, or on failure', async () => {
    views.similar.mockResolvedValue(null);
    expect(await MobileSimilarSection({ incidentId: 'inc-x' })).toBeNull();
    views.similar.mockRejectedValue(new Error('db down'));
    expect(await MobileSimilarSection({ incidentId: 'inc-x' })).toBeNull();
    views.response.mockResolvedValue({ changes: [], upstreamIncidents: [], runbooks: [] });
    expect(await MobileResponseSection({ incidentId: 'inc-x' })).toBeNull();
    views.triage.mockResolvedValue(null);
    expect(await MobileTriageSection({ incidentId: 'inc-x' })).toBeNull();
  });

  it('shows causes and runbooks', async () => {
    views.response.mockResolvedValue({
      changes: [
        {
          findingId: 'f1',
          changeId: 'c1',
          kind: 'DEPLOY',
          summary: 'Deploy v42',
          source: 'github',
          version: 'v42',
          url: null,
          serviceName: 'Checkout',
          occurredAt: new Date(),
          leadMinutes: 12,
          relation: 'SAME_SERVICE',
          confidencePercent: 70,
          riskPercent: 55,
        },
      ],
      upstreamIncidents: [],
      runbooks: [
        {
          findingId: 'r1',
          runbookId: 'rb-1',
          name: 'Restart pool',
          succeeded: 3,
          eligible: 4,
          bound: true,
        },
      ],
    });
    render(await MobileResponseSection({ incidentId: 'inc-x' }));
    expect(screen.getByRole('heading', { name: 'Possible causes' })).toBeInTheDocument();
    expect(screen.getByText(/12 min before onset · Checkout · risk 55%/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Restart pool/ })).toHaveAttribute(
      'href',
      '/runbooks/rb-1'
    );
  });

  it('shows triage chips with touch-sized actions', async () => {
    views.triage.mockResolvedValue({
      canAct: true,
      suggestions: [
        {
          findingId: 't1',
          confidencePercent: 72,
          precedents: 4,
          urgency: 'HIGH',
          owner: null,
          duplicate: null,
          resolution: null,
          sloBurning: false,
          myVerdict: null,
        },
      ],
    });
    render(await MobileTriageSection({ incidentId: 'inc-x' }));
    expect(screen.getByText('Set urgency to HIGH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' }).className).toContain('h-11');
  });
});
