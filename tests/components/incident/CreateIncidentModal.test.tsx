import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateIncidentModal from '@/components/incident/CreateIncidentModal';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
  }),
}));

const mockCloseCreateIncident = vi.fn();
let mockIsOpen = true;
let mockOpenOptions: { serviceId?: string; templateId?: string } | null = null;

vi.mock('@/contexts/IncidentCreationModalContext', () => ({
  useCreateIncidentModal: () => ({
    isOpen: mockIsOpen,
    openOptions: mockOpenOptions,
    openCreateIncident: vi.fn(),
    closeCreateIncident: mockCloseCreateIncident,
  }),
}));

const mockContextData = {
  canCreateIncident: true,
  services: [
    { id: 'srv-checkout', name: 'Checkout API' },
    { id: 'srv-auth', name: 'Authentication Service' },
  ],
  users: [
    { id: 'usr-1', name: 'Alice Smith', email: 'alice@example.com', avatarUrl: null },
    { id: 'usr-2', name: 'Bob Jones', email: 'bob@example.com', avatarUrl: null },
  ],
  teams: [{ id: 'team-sre', name: 'SRE Core' }],
  customFields: [],
  templates: [
    {
      id: 'tpl-1',
      name: 'High Latency Advisory',
      title: 'Database connection pool high latency',
      descriptionText: 'Observed connection timeout spike above SLA.',
      defaultUrgency: 'HIGH' as const,
      defaultPriority: 'P1',
      defaultService: { id: 'srv-checkout', name: 'Checkout API' },
    },
  ],
};

const mockCreateIncident = vi.fn().mockResolvedValue({ id: 'inc-new-123' });
const mockGetIncidentCreationContext = vi.fn().mockResolvedValue(mockContextData);

vi.mock('@/app/(app)/incidents/actions', () => ({
  createIncident: (...args: unknown[]) => mockCreateIncident(...args),
  getIncidentCreationContext: () => mockGetIncidentCreationContext(),
}));

describe('CreateIncidentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOpen = true;
    mockOpenOptions = null;
  });

  it('renders modal header, fields, live preview, and templates after context loads', async () => {
    render(<CreateIncidentModal />);

    // Wait for context to resolve and form to appear
    expect(await screen.findByText('Declare Incident')).toBeInTheDocument();
    expect(screen.getByText('Triage Mode')).toBeInTheDocument();

    // Template Bar
    expect(screen.getByText('Incident Templates')).toBeInTheDocument();
    expect(screen.getByText('Start from scratch')).toBeInTheDocument();
    expect(screen.getByText('High Latency Advisory')).toBeInTheDocument();

    // Required fields
    expect(
      screen.getByPlaceholderText(/Primary database connection pool exhausted/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Summary & Context')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Affected Service/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Responder Assignment/i })).toBeInTheDocument();

    // Severity & Urgency
    expect(screen.getByText(/Urgency \(Paging Speed\)/i)).toBeInTheDocument();
    expect(screen.getByText('Immediate Paging')).toBeInTheDocument();
    expect(screen.getByText(/Priority \(Severity\)/i)).toBeInTheDocument();
    expect(screen.getAllByText('P1').length).toBeGreaterThanOrEqual(1);

    // Live Incident Card Preview
    expect(screen.getByText('Live Incident Card Preview')).toBeInTheDocument();
    expect(screen.getByText('#PREVIEW')).toBeInTheDocument();

    // Action buttons
    expect(screen.getByRole('button', { name: /^create incident$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('updates the live card preview dynamically when typing title', async () => {
    render(<CreateIncidentModal />);

    const titleInput = await screen.findByPlaceholderText(
      /Primary database connection pool exhausted/i
    );
    fireEvent.change(titleInput, { target: { value: 'Global DNS Resolution Failure' } });

    // Both input and preview should display the title
    await waitFor(() => {
      const matches = screen.getAllByText('Global DNS Resolution Failure');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('prefills fields when a template is selected', async () => {
    render(<CreateIncidentModal />);

    const templatePill = await screen.findByText('High Latency Advisory');
    fireEvent.click(templatePill);

    await waitFor(() => {
      const titleInput = screen.getByPlaceholderText(
        /Primary database connection pool exhausted/i
      ) as HTMLInputElement;
      expect(titleInput.value).toBe('Database connection pool high latency');
    });
  });

  it('allows selecting urgency and priority', async () => {
    render(<CreateIncidentModal />);

    await screen.findByText('Declare Incident');

    // Click Low Urgency button by title
    const lowUrgencyBtn = screen.getByTitle(/No immediate page/i);
    fireEvent.click(lowUrgencyBtn);
    expect(lowUrgencyBtn.getAttribute('aria-pressed')).toBe('true');

    // Click P2 Priority button by title
    const p2Btn = screen.getByTitle(/P2 \(High\)/i);
    fireEvent.click(p2Btn);
    expect(p2Btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls closeCreateIncident when Cancel is clicked', async () => {
    render(<CreateIncidentModal />);

    const cancelBtn = await screen.findByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(mockCloseCreateIncident).toHaveBeenCalled();
  });
});
