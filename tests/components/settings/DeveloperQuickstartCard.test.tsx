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
      <DeveloperQuickstartCard
        appUrl="https://api.test.opsknight.com"
        revealedSecret="ok_live_secret123"
      />
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
    selectScenario(/sample ping/i);
    const runBtn = screen.getByRole('button', { name: /run live test/i }) as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    expect(runBtn.disabled).toBe(false);
  });

  it('sends the pasted key, not the placeholder, and shows the real response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
    fireEvent.change(screen.getByLabelText(/service id/i), { target: { value: 'svc_real_1' } });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).service_id).toBe('svc_real_1');
  });
  it('marks an unauthenticated 200 from /api/sample as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { authenticated: false } }), {
          status: 200,
        })
      )
    );
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/sample ping/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_wrongkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    const badge = await screen.findByText(/not authenticated/i);
    expect(badge.className).toContain('rose');
  });

  it('shows a network failure as failed, not green', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/sample ping/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    const badge = await screen.findByText(/request failed/i);
    expect(badge.className).toContain('rose');
  });

  it('requires a real resource id instead of using an invented one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/acknowledge/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    const run = screen.getByRole('button', { name: /run live test/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(document.body.textContent).toContain('YOUR_INCIDENT_ID');
    expect(document.body.textContent).not.toContain('inc_9f8d1e2a/acknowledge');

    fireEvent.change(screen.getByLabelText(/incident id/i), { target: { value: 'inc_real_1' } });
    expect(run.disabled).toBe(false);
    fireEvent.click(run);
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/incidents/inc_real_1/acknowledge');
  });
  it('treats unusual characters in a resource id as invalid input instead of crashing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/ingest alert/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    // A quote would have broken the old JSON-text substitution.
    fireEvent.change(screen.getByLabelText(/service id/i), { target: { value: 'svc"}, "x' } });

    expect(screen.getByRole('alert').textContent).toMatch(/letters, numbers/);
    const run = screen.getByRole('button', { name: /run live test/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    // The sample still renders, with the placeholder rather than the invalid value.
    expect(document.body.textContent).toContain('YOUR_SERVICE_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('URL-encodes path parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);
    selectScenario(/acknowledge/i);
    fireEvent.change(screen.getByLabelText(/api key for live tests/i), {
      target: { value: 'ok_live_realkey123' },
    });
    fireEvent.change(screen.getByLabelText(/incident id/i), { target: { value: '../admin' } });
    expect(
      (screen.getByRole('button', { name: /run live test/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/incident id/i), { target: { value: 'inc_Real-1' } });
    fireEvent.click(screen.getByRole('button', { name: /run live test/i }));
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/incidents/inc_Real-1/acknowledge');
  });
});
