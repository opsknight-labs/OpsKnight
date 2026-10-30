import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import { notify } from '@/lib/toast';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAction(action: (form: FormData) => Promise<void>) {
  render(
    <McpConfirmAction
      action={action}
      fields={{ kind: 'grant', id: 'g1' }}
      label="Revoke"
      accessibleLabel="Revoke Claude for Jane"
      title="Revoke this connection?"
      description="Claude loses access."
      confirmLabel="Revoke connection"
      successMessage="Connection revoked"
    />
  );
}

it('only calls the server action after confirmation, with the row fields', async () => {
  const action = vi.fn<(form: FormData) => Promise<void>>().mockResolvedValue(undefined);
  renderAction(action);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Claude for Jane' }));
  expect(screen.getByRole('alertdialog', { name: 'Revoke this connection?' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(action).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Revoke Claude for Jane' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke connection' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  const form = action.mock.calls[0]![0];
  expect(form.get('kind')).toBe('grant');
  expect(form.get('id')).toBe('g1');
  await waitFor(() =>
    expect(notify.success).toHaveBeenCalledWith('Connection revoked', expect.anything())
  );
  expect(refresh).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

it('keeps the dialog open and reports the error when the action fails', async () => {
  const failure = new Error('MCP_ADMIN_REQUIRED');
  const action = vi.fn<(form: FormData) => Promise<void>>().mockRejectedValue(failure);
  renderAction(action);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Claude for Jane' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke connection' }));
  await waitFor(() => expect(notify.error).toHaveBeenCalledWith(failure, expect.anything()));
  expect(screen.getByRole('alertdialog')).toBeVisible();
  expect(refresh).not.toHaveBeenCalled();
});
