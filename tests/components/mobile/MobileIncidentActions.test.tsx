import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MobileIncidentActions from '@/app/(mobile)/m/incidents/[id]/actions';
import { useRouter } from 'next/navigation';
import { updateIncidentStatus, resolveIncidentWithNote } from '@/app/(app)/incidents/actions';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

// Mock dependencies
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

vi.mock('@/app/(app)/incidents/actions', () => ({
  updateIncidentStatus: vi.fn(),
  addNote: vi.fn(),
  updateIncidentUrgency: vi.fn(),
  reassignIncident: vi.fn(),
  resolveIncidentWithNote: vi.fn(),
}));

describe('MobileIncidentActions', () => {
  const mockRouter = {
    back: vi.fn(),
    forward: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  } as unknown as AppRouterInstance;
  const defaultProps = {
    incidentId: 'inc-123',
    status: 'OPEN',
    urgency: 'HIGH',
    assigneeId: null,
    currentUserId: 'user-1',
    users: [{ id: 'user-1', name: 'User 1', email: 'u1@test.com' }],
    teams: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue(mockRouter);
  });

  it('renders Acknowledge button when status is OPEN', () => {
    render(<MobileIncidentActions {...defaultProps} status="OPEN" />);
    expect(screen.getByText('Acknowledge')).toBeInTheDocument();
  });

  it('calls updateIncidentStatus on Acknowledge click', async () => {
    vi.mocked(updateIncidentStatus).mockResolvedValue({ replayed: false });
    render(<MobileIncidentActions {...defaultProps} status="OPEN" />);

    fireEvent.click(screen.getByText('Acknowledge'));

    await waitFor(() => {
      expect(updateIncidentStatus).toHaveBeenCalledWith('inc-123', 'ACKNOWLEDGED');
      expect(mockRouter.refresh).toHaveBeenCalled();
    });
  });

  it('shows resolution input when Resolve clicked', () => {
    render(<MobileIncidentActions {...defaultProps} status="ACKNOWLEDGED" />);

    fireEvent.click(screen.getByText('Resolve'));
    expect(screen.getByPlaceholderText(/Describe root cause/i)).toBeInTheDocument();
  });

  it('resolves incident with note', async () => {
    vi.mocked(resolveIncidentWithNote).mockResolvedValue({ replayed: false });
    render(<MobileIncidentActions {...defaultProps} status="ACKNOWLEDGED" />);

    // Open resolve panel
    fireEvent.click(screen.getByText('Resolve'));

    // Type note (needs > 10 chars)
    const input = screen.getByPlaceholderText(/Describe root cause/i);
    fireEvent.change(input, { target: { value: 'Fixed the issue completely.' } }); // 25 chars

    // Click Resolve incident
    fireEvent.click(screen.getByRole('button', { name: 'Resolve incident' }));

    await waitFor(() => {
      expect(resolveIncidentWithNote).toHaveBeenCalledWith(
        'inc-123',
        'Fixed the issue completely.'
      );
      expect(mockRouter.refresh).toHaveBeenCalled();
    });
  });

  it('disables resolve submit when resolution note is too short', () => {
    render(<MobileIncidentActions {...defaultProps} status="ACKNOWLEDGED" />);

    fireEvent.click(screen.getByText('Resolve'));

    const input = screen.getByPlaceholderText(/Describe root cause/i);
    fireEvent.change(input, { target: { value: 'Short' } });

    // Button should be disabled or handle click with check
    const btn = screen.getByRole('button', { name: 'Resolve incident' });
    expect(btn).toBeDisabled();
  });
});
