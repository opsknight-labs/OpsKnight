import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MobileCreateIncidentClient from '@/app/(mobile)/m/incidents/create/client';

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockBack = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    refresh: mockRefresh,
  }),
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
  }),
}));

const mockToastWarning = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('@/lib/toast', () => ({
  notify: {
    warning: (...args: unknown[]) => mockToastWarning(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock('@/lib/mobile-cache', () => ({
  readCache: vi.fn().mockResolvedValue(null),
  writeCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/mobile-cache-status', () => ({
  removeMobileCacheEntry: vi.fn(),
}));

const mockServices = [
  { id: 'srv-1', name: 'Billing Engine', defaultIncidentVisibility: 'PUBLIC' as const },
  { id: 'srv-2', name: 'Notification Service', defaultIncidentVisibility: 'PRIVATE' as const },
];

const mockUsers = [{ id: 'usr-1', name: 'Jane Doe', email: 'jane@example.com' }];

const mockTemplates = [
  {
    id: 'tmpl-1',
    name: 'Latency Template',
    title: 'High latency detected',
    descriptionText: 'Description here',
    defaultUrgency: 'HIGH' as const,
    defaultPriority: 'P1',
    defaultService: { id: 'srv-1', name: 'Billing Engine' },
  },
];

describe('MobileCreateIncidentClient Required Field Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows warning popup when submitting without title and without service', async () => {
    render(
      <MobileCreateIncidentClient
        services={mockServices}
        users={mockUsers}
        templates={mockTemplates}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /create incident/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalledWith(
        'Required fields missing',
        expect.objectContaining({
          description: 'Please enter a title and select an affected service.',
        })
      );
      expect(
        screen.getByText('Please enter a title and select an affected service.')
      ).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText(/Title/i);
    expect(titleInput.getAttribute('aria-invalid')).toBe('true');

    const serviceSelect = screen.getByLabelText(/Service/i);
    expect(serviceSelect.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows warning popup when title is provided but service is missing', async () => {
    render(
      <MobileCreateIncidentClient
        services={mockServices}
        users={mockUsers}
        templates={mockTemplates}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /create incident/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'Production Outage' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalledWith(
        'Affected service required',
        expect.objectContaining({
          description: 'Please select an affected service before creating the incident.',
        })
      );
      expect(
        screen.getByText('Select an affected service before creating the incident.')
      ).toBeInTheDocument();
    });

    const serviceSelect = screen.getByLabelText(/Service/i);
    expect(serviceSelect.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows warning popup when service is selected but title is empty', async () => {
    render(
      <MobileCreateIncidentClient
        services={mockServices}
        users={mockUsers}
        templates={mockTemplates}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /create incident/i });
    await waitFor(() => expect(submitBtn).not.toBeDisabled());

    const serviceSelect = screen.getByLabelText(/Service/i);
    fireEvent.change(serviceSelect, { target: { value: 'srv-1' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalledWith(
        'Incident title required',
        expect.objectContaining({
          description: 'Please enter an incident title before creating the incident.',
        })
      );
      expect(screen.getByText('Title is required.')).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText(/Title/i);
    expect(titleInput.getAttribute('aria-invalid')).toBe('true');
  });
});
