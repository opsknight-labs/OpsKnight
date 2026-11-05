import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import McpConnectGuide from '@/components/settings/mcp/McpConnectGuide';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const endpoint = 'https://ops.example.com/mcp';
const hrefs = { connections: '/settings/integrations/mcp?tab=connections', overview: '/o' };
const tab = (name: string) => {
  const found = screen.getAllByRole('tab').find(element => element.textContent === name);
  if (!found) throw new Error(`No tab ${name}`);
  return found;
};
const openTab = (name: string) => fireEvent.mouseDown(tab(name), { button: 0 });

describe('Connect guide', () => {
  it('gives ChatGPT the current Plugins flow, with Secure MCP Tunnel for private installs (INT-04)', () => {
    render(<McpConnectGuide endpoint={endpoint} version="2.2.0" />);
    openTab('ChatGPT');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Add custom MCP server');
    expect(panel.textContent).toContain('choose Tunnel for a private');
    expect(panel.textContent).not.toContain('Settings → Connectors');
  });

  it('has an Other clients tab with Codex, Gemini CLI and Windsurf filled in (INT-06/UX-11)', () => {
    render(<McpConnectGuide endpoint={endpoint} version="2.2.0" />);
    openTab('Other clients');
    const commands = mcpSetupCommands(endpoint, '2.2.0');
    const panel = screen.getByRole('tabpanel').textContent ?? '';
    for (const value of [
      endpoint,
      commands.codex,
      commands.codexLogin,
      commands.geminiCli,
      commands.geminiSettings,
      commands.windsurf,
    ])
      expect(panel).toContain(value);
    // Shell-quoted, with each client's own config key.
    expect(commands.codex).toBe(`codex mcp add opsknight --url '${endpoint}'`);
    expect(commands.geminiSettings).toContain('"httpUrl"');
    expect(commands.windsurf).toContain('"serverUrl"');
    expect(screen.getByRole('link', { name: 'compatibility table' }).getAttribute('href')).toMatch(
      /self-hosted-setup\.md#client-compatibility$/
    );
  });

  it('remembers the chosen assistant, starting from Claude Code', async () => {
    const { unmount } = render(<McpConnectGuide endpoint={endpoint} version="2.2.0" />);
    expect(tab('Claude Code').getAttribute('aria-selected')).toBe('true');
    openTab('Cursor');
    expect(window.localStorage.getItem('opsknight.mcp.connect-tab')).toBe('cursor');
    unmount();
    render(<McpConnectGuide endpoint={endpoint} version="2.2.0" />);
    await waitFor(() => expect(tab('Cursor').getAttribute('aria-selected')).toBe('true'));
  });

  it('ignores a stored tab that no longer exists', async () => {
    window.localStorage.setItem('opsknight.mcp.connect-tab', 'gone');
    render(<McpConnectGuide endpoint={endpoint} version="2.2.0" />);
    await act(async () => undefined);
    expect(tab('Claude Code').getAttribute('aria-selected')).toBe('true');
  });

  it('reports the new connection on "Check connection", or what to do next', async () => {
    const check = vi.fn().mockResolvedValueOnce({ connected: false }).mockResolvedValueOnce({
      connected: true,
      client: 'Claude Code',
      createdAt: new Date().toISOString(),
    });
    render(
      <McpConnectGuide endpoint={endpoint} version="2.2.0" checkConnection={check} hrefs={hrefs} />
    );
    // The button renders after mount; wait for it rather than racing a slow runner.
    fireEvent.click(await screen.findByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText(/Not connected yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'setup check' }).getAttribute('href')).toBe('/o');
    fireEvent.click(await screen.findByRole('button', { name: 'Check connection' }));
    expect(await screen.findByText(/Connected: Claude Code, just now/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View connection' }).getAttribute('href')).toBe(
      hrefs.connections
    );
  });

  it('pins the doctor download to the running release', () => {
    expect(mcpSetupCommands(endpoint, '2.2.0').doctor).toBe(
      "curl -fsSLo opsknight-mcp-doctor.cjs https://raw.githubusercontent.com/opsknight-labs/OpsKnight/v2.2.0/scripts/mcp/doctor.cjs && node opsknight-mcp-doctor.cjs 'https://ops.example.com/mcp'"
    );
  });
});
