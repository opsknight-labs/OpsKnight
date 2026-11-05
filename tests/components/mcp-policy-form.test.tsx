import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpPolicyForm from '@/components/settings/mcp/McpPolicyForm';
import { notify } from '@/lib/toast';

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
const signOut = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ signOut }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows saving feedback, prevents duplicate submissions and reports success only after saving', async () => {
  let finish!: () => void;
  const action = vi.fn<(form: FormData) => Promise<void>>(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      })
  );
  render(
    <McpPolicyForm action={action}>
      <input aria-label="Scopes" name="dcrScopes" defaultValue="incidents:read" />
    </McpPolicyForm>
  );
  const button = screen.getByRole('button', { name: 'Save policy' });
  const form = button.closest('form')!;
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByLabelText('Scopes')).toBeDisabled();
  fireEvent.submit(form);
  expect(action).toHaveBeenCalledTimes(1);
  expect(action.mock.calls[0]?.[0].get('dcrScopes')).toBe('incidents:read');
  expect(notify.success).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(button).toBeEnabled());
  expect(notify.success).toHaveBeenCalledWith('MCP configuration saved', {
    id: 'settings:mcp:save',
  });
  expect(screen.getByRole('status')).toHaveTextContent('Saved');
  fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'services:read' } });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('uses the shared error banner, preserves edits and allows retry after a failed save', async () => {
  const failure = new Error('server failure');
  const action = vi
    .fn<(form: FormData) => Promise<void>>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(undefined);
  render(
    <McpPolicyForm action={action}>
      <input aria-label="Scopes" name="dcrScopes" defaultValue="incidents:read" />
    </McpPolicyForm>
  );
  const input = screen.getByLabelText('Scopes');
  fireEvent.change(input, { target: { value: 'services:read' } });
  const button = screen.getByRole('button', { name: 'Save policy' });
  fireEvent.submit(button.closest('form')!);
  await waitFor(() =>
    expect(notify.error).toHaveBeenCalledWith(failure, { id: 'settings:mcp:save' })
  );
  expect(notify.success).not.toHaveBeenCalled();
  expect(input).toHaveValue('services:read');
  expect(screen.getByRole('status')).toHaveTextContent('Configuration was not saved.');
  expect(button).toBeEnabled();
  fireEvent.submit(button.closest('form')!);
  await waitFor(() => expect(notify.success).toHaveBeenCalledTimes(1));
  expect(action).toHaveBeenCalledTimes(2);
});

it('asks for a fresh sign-in, not a reload, when a widening save is refused', async () => {
  const action = vi.fn(async () => ({
    ok: false as const,
    code: 'MCP_REAUTHENTICATION_REQUIRED' as const,
  }));
  render(
    <McpPolicyForm action={action} revision={3}>
      <input aria-label="Scopes" name="dcrScopes" defaultValue="incidents:read" />
    </McpPolicyForm>
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Save policy' }).closest('form')!);
  await waitFor(() => expect(screen.getByText('Sign in again to save')).toBeInTheDocument());
  expect(notify.success).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Reload policy' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  expect(signOut).toHaveBeenCalledWith({
    callbackUrl: `/login?callbackUrl=${encodeURIComponent('/settings/integrations/mcp')}`,
  });
});
