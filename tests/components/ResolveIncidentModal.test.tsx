import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResolveIncidentModal from '@/components/incident/ResolveIncidentModal';
import { resolveIncidentWithNote } from '@/app/(app)/incidents/actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const mockShowToast = vi.fn();
vi.mock('@/hooks/use-product-notification', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('@/app/(app)/incidents/actions', () => ({
  resolveIncidentWithNote: vi.fn(),
}));

describe('ResolveIncidentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testIncident = {
    id: 'inc-1234567890',
    title: 'High CPU utilization on worker pool',
    service: { name: 'Worker Service' },
  };

  it('renders modal with incident details and disabled resolve button when note is empty', () => {
    render(<ResolveIncidentModal incident={testIncident} open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /resolve incident/i })).toBeDefined();
    expect(screen.getByText('High CPU utilization on worker pool')).toBeDefined();
    expect(screen.getByText('Worker Service')).toBeDefined();

    const submitBtn = screen.getByRole('button', { name: /resolve incident/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables submit button only when note is at least 10 characters', () => {
    render(<ResolveIncidentModal incident={testIncident} open={true} onOpenChange={vi.fn()} />);

    const textarea = screen.getByRole('textbox', { name: /resolution note/i });
    const submitBtn = screen.getByRole('button', { name: /resolve incident/i });

    // Type 8 characters (too short)
    fireEvent.change(textarea, { target: { value: 'Fixed it' } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/2 more chars needed/i)).toBeDefined();

    // Type 15 characters (valid)
    fireEvent.change(textarea, { target: { value: 'Scaled worker pods to 5 replicas' } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits resolution note and triggers actions and callbacks on success', async () => {
    vi.mocked(resolveIncidentWithNote).mockResolvedValue({ replayed: false });
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    render(
      <ResolveIncidentModal
        incident={testIncident}
        open={true}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />
    );

    const textarea = screen.getByRole('textbox', { name: /resolution note/i });
    fireEvent.change(textarea, {
      target: { value: 'Scaled worker pool replicas to resolve CPU saturation.' },
    });

    const submitBtn = screen.getByRole('button', { name: /resolve incident/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(resolveIncidentWithNote).toHaveBeenCalledWith(
        'inc-1234567890',
        'Scaled worker pool replicas to resolve CPU saturation.'
      );
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('resolved successfully'),
        'success'
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onSuccess).toHaveBeenCalledWith('inc-1234567890');
    });
  });

  it('displays error if resolve action fails', async () => {
    vi.mocked(resolveIncidentWithNote).mockRejectedValue(new Error('Database network timeout'));

    render(<ResolveIncidentModal incident={testIncident} open={true} onOpenChange={vi.fn()} />);

    const textarea = screen.getByRole('textbox', { name: /resolution note/i });
    fireEvent.change(textarea, {
      target: { value: 'Patched DNS config to resolve reachability.' },
    });

    const submitBtn = screen.getByRole('button', { name: /resolve incident/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Database network timeout')).toBeDefined();
    });
  });
});
