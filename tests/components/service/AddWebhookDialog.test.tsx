import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddWebhookDialog from '@/components/service/AddWebhookDialog';

vi.mock('@/app/(app)/services/[id]/webhooks/actions', () => ({
  createWebhookIntegration: vi.fn(),
}));

describe('AddWebhookDialog', () => {
  it('renders the Add Webhook trigger button', () => {
    render(<AddWebhookDialog serviceId="svc-123" />);

    const trigger = screen.getByRole('button', { name: /add webhook/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens the dialog when clicking Add Webhook', () => {
    render(<AddWebhookDialog serviceId="svc-123" />);

    const trigger = screen.getByRole('button', { name: /add webhook/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('heading', { name: /add outbound webhook/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/integration name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/webhook platform type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/webhook url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secret/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/channel \/ room/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create webhook/i })).toBeInTheDocument();
  });

  it('allows filling in webhook fields and selecting platform', () => {
    render(<AddWebhookDialog serviceId="svc-123" />);

    const trigger = screen.getByRole('button', { name: /add webhook/i });
    fireEvent.click(trigger);

    const nameInput = screen.getByLabelText(/integration name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Production Alert Slack' } });
    expect(nameInput.value).toBe('Production Alert Slack');

    const select = screen.getByLabelText(/webhook platform type/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'SLACK' } });
    expect(select.value).toBe('SLACK');

    const urlInput = screen.getByLabelText(/webhook url/i) as HTMLInputElement;
    fireEvent.change(urlInput, {
      target: { value: 'https://hooks.slack.com/services/T00/B00/XXXX' },
    });
    expect(urlInput.value).toBe('https://hooks.slack.com/services/T00/B00/XXXX');
  });
});
