import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import PublicStatusPage from '@/app/(public)/status/page';

// Mock the prisma client
const mockPrisma = vi.hoisted(() => ({
  statusPage: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  service: {
    findMany: vi.fn(),
  },
  incident: {
    findMany: vi.fn(),
    groupBy: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  slaPolicy: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
}));
const mockGetStatusPageSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/status-pages/snapshot', () => ({
  getStatusPageSnapshot: mockGetStatusPageSnapshot,
  getStatusPageSnapshotByRoute: mockGetStatusPageSnapshot,
}));

vi.mock('@/lib/sla-server', () => ({
  calculateSLAMetrics: vi.fn().mockResolvedValue({
    dynamicStatus: 'OPERATIONAL',
    activeIncidents: 0,
    totalIncidents: 0,
    serviceMetrics: [],
  }),
  calculateMultiServiceUptime: vi.fn().mockResolvedValue(new Map()),
  getExternalIncidentStatus: vi.fn().mockReturnValue('investigating'),
  getExternalStatusLabel: vi.fn().mockReturnValue('Investigating'),
}));

// Mock child components to simplify testing
vi.mock('@/components/status-page/StatusPageHeader', () => ({
  default: () => <div data-testid="status-page-header">Header</div>,
}));
vi.mock('@/components/status-page/StatusPageV3', () => ({
  default: () => <div data-testid="status-page-v3">Status Page V3</div>,
}));

describe('PublicStatusPage Custom CSS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatusPageSnapshot.mockResolvedValue({
      stale: false,
      snapshot: {
        schemaVersion: 2,
        pageId: 'sp-1',
        revision: '1',
        generatedAt: '2026-09-08T00:00:00.000Z',
        page: {
          id: 'sp-1',
          name: 'Status Page',
          organizationName: null,
          branding: {},
          showSubscribe: false,
          showServicesByRegion: false,
          showRegionHeatmap: false,
          showPostIncidentReview: false,
          showChangelog: false,
          enableUptimeExports: false,
          footerText: null,
          contactEmail: null,
          contactUrl: null,
          slug: null,
          customDomain: null,
          subdomain: null,
          isDefault: true,
          requireAuth: false,
        },
        status: 'operational',
        services: [],
        incidents: [],
        uptime: {},
        statusHistory: {},
        announcements: [],
        historyDays: 90,
      },
    });
  });

  it('renders custom css when provided in status page config', async () => {
    const customCss = '.custom-class { color: red !important; }';

    // Mock the status page response with custom CSS
    mockPrisma.statusPage.findFirst.mockResolvedValue({
      id: 'sp-1',
      name: 'Status Page',
      enabled: true,
      showServices: true,
      showIncidents: true,
      branding: {
        customCss: customCss,
        primaryColor: '#000000',
      },
      services: [],
      announcements: [],
    });
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.incident.findMany.mockResolvedValue([]);
    const projection = await mockGetStatusPageSnapshot();
    mockGetStatusPageSnapshot.mockResolvedValue({
      ...projection,
      snapshot: {
        ...projection.snapshot,
        page: { ...projection.snapshot.page, branding: { customCss } },
      },
    });

    // We need to await the component since it's an async server component
    // In actual Next.js this is handled by the framework, but for testing we await it directly
    const component = await PublicStatusPage();
    render(component);

    // Look for the style tag containing our custom CSS
    // The style tag is rendered using dangerouslySetInnerHTML, so we can check if the text exists in the document
    // We might need to inspect the rendered HTML or look for a style element
    const styleTags = document.querySelectorAll('style');
    let cssFound = false;

    styleTags.forEach(tag => {
      if (tag.innerHTML.includes(customCss)) {
        cssFound = true;
      }
    });

    expect(cssFound).toBe(true);
  }, 15000);

  it('does not render custom css when not provided', async () => {
    mockPrisma.statusPage.findFirst.mockResolvedValue({
      id: 'sp-1',
      name: 'Status Page',
      enabled: true,
      branding: {
        customCss: '',
      },
      services: [],
      announcements: [],
    });
    mockPrisma.service.findMany.mockResolvedValue([]);
    mockPrisma.incident.findMany.mockResolvedValue([]);
    const projection = await mockGetStatusPageSnapshot();
    mockGetStatusPageSnapshot.mockResolvedValue({
      ...projection,
      snapshot: {
        ...projection.snapshot,
        page: { ...projection.snapshot.page, branding: { customCss: '' } },
      },
    });

    const component = await PublicStatusPage();
    render(component);

    const styleTags = document.querySelectorAll('style');
    let cssFound = false;

    const customCssSignature = '.custom-class';

    styleTags.forEach(tag => {
      if (tag.innerHTML.includes(customCssSignature)) {
        cssFound = true;
      }
    });

    expect(cssFound).toBe(false);
  });
});
