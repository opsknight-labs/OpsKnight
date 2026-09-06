import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ServiceVisibilitySettings from '@/components/service/ServiceVisibilitySettings';
import { updateServiceDefaultVisibility } from '@/app/(app)/services/actions';
import { notify } from '@/lib/toast';

vi.mock('@/lib/toast', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/app/(app)/services/actions', () => ({
  updateServiceDefaultVisibility: vi.fn(),
}));

describe('ServiceVisibilitySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default Public correctly with active badge', () => {
    render(
      <ServiceVisibilitySettings
        serviceId="svc-1"
        defaultIncidentVisibility="PUBLIC"
        canManage={true}
      />
    );

    expect(screen.getByText('Default Incident Visibility')).toBeInTheDocument();
    expect(screen.getByText('Default: Public')).toBeInTheDocument();
    expect(screen.getByText('Customer-Facing Outage')).toBeInTheDocument();
    expect(screen.getByText('Internal System Only')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save visibility/i });
    expect(saveButton).toBeDisabled();
  });

  it('renders default Private correctly with active badge', () => {
    render(
      <ServiceVisibilitySettings
        serviceId="svc-2"
        defaultIncidentVisibility="PRIVATE"
        canManage={true}
      />
    );

    expect(screen.getByText('Default: Private')).toBeInTheDocument();
  });

  it('enables Save button when user changes selection and executes save action', async () => {
    vi.mocked(updateServiceDefaultVisibility).mockResolvedValueOnce({
      success: true,
      visibility: 'PRIVATE',
    });

    render(
      <ServiceVisibilitySettings
        serviceId="svc-1"
        defaultIncidentVisibility="PUBLIC"
        canManage={true}
      />
    );

    const privateCard = screen.getByText('Internal System Only').closest('button')!;
    fireEvent.click(privateCard);

    const saveButton = screen.getByRole('button', { name: /save visibility/i });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateServiceDefaultVisibility).toHaveBeenCalledWith('svc-1', 'PRIVATE');
      expect(notify.success).toHaveBeenCalledWith('Default incident visibility updated to Private');
    });
  });

  it('disables option cards and hides save button when canManage is false', () => {
    render(
      <ServiceVisibilitySettings
        serviceId="svc-read-only"
        defaultIncidentVisibility="PUBLIC"
        canManage={false}
      />
    );

    const publicCard = screen.getByText('Customer-Facing Outage').closest('button')!;
    const privateCard = screen.getByText('Internal System Only').closest('button')!;

    expect(publicCard).toBeDisabled();
    expect(privateCard).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save visibility/i })).not.toBeInTheDocument();
  });
});
