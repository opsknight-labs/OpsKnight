import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResolveIncidentModal from '@/components/incident/ResolveIncidentModal';
import { resolveIncidentWithNote } from '@/app/(app)/incidents/actions';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const mockNotifySuccess = vi.hoisted(() => vi.fn());
vi.mock('@/lib/toast', () => ({
  notify: { success: mockNotifySuccess, error: vi.fn(), warning: vi.fn(), info: vi.fn() },
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
      expect(mockNotifySuccess).toHaveBeenCalledWith(
        expect.stringContaining('resolved successfully')
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

  it('offers to start the postmortem next, on by default for P1, and opens it after resolving', async () => {
    vi.mocked(resolveIncidentWithNote).mockResolvedValue({ replayed: false });
    render(
      <ResolveIncidentModal
        incident={{ ...testIncident, priority: 'P1', postmortemHref: '/postmortems/inc-1234567890' }}
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    const option = screen.getByRole('checkbox', { name: /start the postmortem next/i });
    expect(option).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: /resolution note/i }), {
      target: { value: 'Rolled back v2.41.0 and confirmed recovery.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /resolve incident/i }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/postmortems/inc-1234567890'));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('does not offer the postmortem without a link (viewer cannot write it)', () => {
    render(<ResolveIncidentModal incident={testIncident} open={true} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox', { name: /start the postmortem next/i })).toBeNull();
  });
});
