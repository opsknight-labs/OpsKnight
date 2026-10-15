import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import DeveloperQuickstartCard from '@/components/settings/DeveloperQuickstartCard';

describe('DeveloperQuickstartCard Component', () => {
  it('renders title, supported header formats, and language tabs', () => {
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);

    expect(screen.getByText('Developer API Quickstart')).toBeDefined();
    expect(screen.getByText('cURL')).toBeDefined();
    expect(screen.getByText('Node.js / Fetch')).toBeDefined();
    expect(screen.getByText('Python (requests)')).toBeDefined();
    expect(screen.getByText(/header formats supported:/i)).toBeDefined();
    expect(screen.getByText('Bearer <token>')).toBeDefined();
    expect(screen.getByText('X-API-Key')).toBeDefined();
  });

  it('switches authentication header format between Bearer and X-API-Key', () => {
    const { container } = render(
      <DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" revealedSecret="ok_live_secret123" />
    );

    // Initial state is Bearer
    expect(container.textContent).toContain('Authorization: Bearer ok_live_secret123');

    // Switch to X-API-Key
    const xApiKeyBtn = screen.getByRole('button', { name: 'X-API-Key' });
    fireEvent.click(xApiKeyBtn);

    expect(container.textContent).toContain('X-API-Key: ok_live_secret123');
  });

  it('switches scenarios and displays corresponding endpoint code', () => {
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);

    // Default scenario is events ingestion
    expect(screen.getByText(/1\. Trigger \/ Ingest Alert/i)).toBeDefined();
    expect(screen.getByText(/events:write/i)).toBeDefined();

    // Click on Incidents scenario
    const incidentsBtn = screen.getByText('2. Incidents');
    fireEvent.click(incidentsBtn);

    expect(screen.getByText(/2\. Query Active Incidents/i)).toBeDefined();
    expect(screen.getByText(/incidents:read/i)).toBeDefined();
  });

  it('switches between code view and expected response view', () => {
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);

    const responseTab = screen.getByRole('button', { name: 'Expected Response' });
    fireEvent.click(responseTab);

    expect(screen.getByText(/expected status:/i)).toBeDefined();
    expect(screen.getByText(/HTTP 202 Accepted/i)).toBeDefined();

    const requestTab = screen.getByRole('button', { name: 'Request Code' });
    fireEvent.click(requestTab);

    expect(screen.getByText(/curl -X POST/i)).toBeDefined();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const selectScenario = (name: RegExp) =>
    fireEvent.click(screen.getAllByRole('button', { name })[0]);

  it('disables live tests until a real API key is provided', () => {
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    const runBtn = screen.getByRole('button', { name: /run live test/i }) as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    expect(runBtn.disabled).toBe(false);
  });

  it('sends the pasted key, not the placeholder, and shows the real response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', authenticated: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/sample ping/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));

    await waitFor(() => expect(screen.getByText(/HTTP 200/i)).toBeDefined());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer ok_live_realkey123');
    // The pasted key never appears in the displayed code samples.
    expect(document.body.textContent).not.toContain('ok_live_realkey123');
  });

  it('reports a network failure instead of showing the sample response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/sample ping/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeDefined());
    expect(screen.queryByText(/HTTP 200/i)).toBeNull();
  });

  it('asks for inline confirmation before sending a request that changes data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/ingest alert/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
