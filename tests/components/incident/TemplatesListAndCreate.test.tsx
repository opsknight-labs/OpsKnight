import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TemplatesListClient, {
  type IncidentTemplateItem,
} from '@/components/incident/TemplatesListClient';
import TemplateCreateForm from '@/components/incident/TemplateCreateForm';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

const mockOpenCreateIncident = vi.fn();
vi.mock('@/contexts/IncidentCreationModalContext', () => ({
  useCreateIncidentModal: () => ({
    isOpen: false,
    openCreateIncident: mockOpenCreateIncident,
    closeCreateIncident: vi.fn(),
  }),
}));

vi.mock('@/app/(app)/incidents/template-actions', () => ({
  deleteTemplate: vi.fn().mockResolvedValue(undefined),
}));

const sampleTemplates: IncidentTemplateItem[] = [
  {
    id: 'tpl-1',
    name: 'Database Outage SOP',
    description: 'Use when database connection pool is full',
    title: '[P1] Primary DB Connection Pool Exhausted',
    descriptionText: 'Check connection counts and kill idle sessions.',
    defaultUrgency: 'HIGH',
    defaultPriority: 'P1',
    defaultServiceId: 'srv-db',
    createdById: 'user-1',
    isPublic: true,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    createdBy: { id: 'user-1', name: 'Alice Smith' },
    defaultService: { id: 'srv-db', name: 'Postgres DB' },
  },
  {
    id: 'tpl-2',
    name: 'Cache Eviction Slowdown',
    description: 'Redis latency spike',
    title: '[P3] Redis Cache Degradation',
    descriptionText: 'Flush expired keys or restart cluster node.',
    defaultUrgency: 'MEDIUM',
    defaultPriority: 'P3',
    defaultServiceId: 'srv-cache',
    createdById: 'user-2',
    isPublic: false,
    createdAt: new Date('2026-09-02T12:00:00Z'),
    createdBy: { id: 'user-2', name: 'Bob Jones' },
    defaultService: { id: 'srv-cache', name: 'Redis Cache' },
  },
];

describe('TemplatesListClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders templates, metadata, and search toolbar', () => {
    render(
      <TemplatesListClient
        templates={sampleTemplates}
        currentUserId="user-1"
        canManageTemplates={true}
      />
    );

    expect(screen.getByText('Database Outage SOP')).toBeInTheDocument();
    expect(screen.getByText('Cache Eviction Slowdown')).toBeInTheDocument();
    expect(screen.getByText('Postgres DB')).toBeInTheDocument();
    expect(screen.getByText('Redis Cache')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('filters templates by search query', () => {
    render(
      <TemplatesListClient
        templates={sampleTemplates}
        currentUserId="user-1"
        canManageTemplates={true}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search templates/i);
    fireEvent.change(searchInput, { target: { value: 'Postgres' } });

    expect(screen.getByText('Database Outage SOP')).toBeInTheDocument();
    expect(screen.queryByText('Cache Eviction Slowdown')).not.toBeInTheDocument();
  });

  it('filters templates by urgency filter pills', () => {
    render(
      <TemplatesListClient
        templates={sampleTemplates}
        currentUserId="user-1"
        canManageTemplates={true}
      />
    );

    const highUrgencyBtn = screen.getByRole('button', { name: /High Urgency/i });
    fireEvent.click(highUrgencyBtn);

    expect(screen.getByText('Database Outage SOP')).toBeInTheDocument();
    expect(screen.queryByText('Cache Eviction Slowdown')).not.toBeInTheDocument();
  });

  it('filters templates by public vs private visibility', () => {
    render(
      <TemplatesListClient
        templates={sampleTemplates}
        currentUserId="user-1"
        canManageTemplates={true}
      />
    );

    const privateBtn = screen.getByRole('button', { name: /^Private/i });
    fireEvent.click(privateBtn);

    expect(screen.queryByText('Database Outage SOP')).not.toBeInTheDocument();
    expect(screen.getByText('Cache Eviction Slowdown')).toBeInTheDocument();
  });

  it('triggers CreateIncidentModal when Use Template is clicked', () => {
    render(
      <TemplatesListClient
        templates={sampleTemplates}
        currentUserId="user-1"
        canManageTemplates={true}
      />
    );

    const useTemplateButtons = screen.getAllByRole('button', { name: /Use Template/i });
    fireEvent.click(useTemplateButtons[0]);

    // First item is tpl-2 because default sort is newest first (tpl-2 is Sep 02, tpl-1 is Sep 01)
    expect(mockOpenCreateIncident).toHaveBeenCalledWith({
      templateId: 'tpl-2',
      serviceId: undefined,
    });
  });
});

describe('TemplateCreateForm', () => {
  const sampleServices = [
    { id: 'srv-db', name: 'Postgres DB' },
    { id: 'srv-cache', name: 'Redis Cache' },
  ];

  it('renders form inputs and live previews', () => {
    render(
      <TemplateCreateForm services={sampleServices} action={vi.fn().mockResolvedValue(null)} />
    );

    expect(screen.getByText('Template Identity')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Database Connection Pool Exhaustion/i)).toBeInTheDocument();
    expect(screen.getByText('Modal Picker Preview')).toBeInTheDocument();
    expect(screen.getByText('Incident Card Preview')).toBeInTheDocument();
  });

  it('switches between Write and Preview tabs for description', () => {
    render(
      <TemplateCreateForm services={sampleServices} action={vi.fn().mockResolvedValue(null)} />
    );

    const writeBtn = screen.getByRole('button', { name: /^write$/i });
    const previewBtn = screen.getByRole('button', { name: /^preview$/i });

    const textarea = screen.getByPlaceholderText(/Provide triage instructions/i);
    fireEvent.change(textarea, { target: { value: '### Immediate Steps\n- Verify connection' } });

    // Switch to preview
    fireEvent.click(previewBtn);
    expect(screen.getByText('Immediate Steps')).toBeInTheDocument();

    // Switch back to write
    fireEvent.click(writeBtn);
    expect(screen.getByPlaceholderText(/Provide triage instructions/i)).toBeInTheDocument();
  });

  it('allows toggling between Public and Private SOP', () => {
    render(
      <TemplateCreateForm services={sampleServices} action={vi.fn().mockResolvedValue(null)} />
    );

    const privateBtn = screen.getByRole('button', { name: /Private SOP/i });
    fireEvent.click(privateBtn);

    // Private badge is displayed
    expect(screen.getAllByText('Private').length).toBeGreaterThanOrEqual(1);
  });
});
