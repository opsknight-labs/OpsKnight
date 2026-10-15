import { describe, it, expect } from 'vitest';
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

  it('executes live test and displays response payload', async () => {
    render(<DeveloperQuickstartCard appUrl="https://api.test.opsknight.com" />);

    const runBtn = screen.getByRole('button', { name: /run live test/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Latency:/i)).toBeDefined();
      expect(screen.getByText(/HTTP 202/i)).toBeDefined();
    });
  });
});
