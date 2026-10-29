import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpCopyField from '@/components/settings/mcp/McpCopyField';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(navigator, 'clipboard', original);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
it('copies the supplied setup command on an explicit click', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const command = 'claude mcp add --transport http opsknight https://ops.example.com/mcp';
  render(<McpCopyField value={command} label="setup command" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup command' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('setup command copied.')
  );
  expect(writeText).toHaveBeenCalledWith(command);
});
it.each(['missing', 'denied'])('offers manual copying when clipboard access is %s', async mode => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value:
      mode === 'missing'
        ? undefined
        : { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  render(<McpCopyField value="https://ops.example.com/mcp" label="MCP endpoint" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy MCP endpoint' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed.'));
  expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  expect(screen.getByText('https://ops.example.com/mcp')).toBeVisible();
});
