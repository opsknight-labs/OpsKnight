import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConsentView from '@/app/oauth/mcp/consent/ConsentView';
import { AssistantIcon } from '@/components/common/BrandLogos';
import type { McpConsentGroup } from '@/lib/mcp/auth/consent-offer';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
afterEach(cleanup);

const groups: McpConsentGroup[] = [
  {
    id: 'incidents',
    label: 'Incidents',
    view: [{ scope: 'incidents:read', label: 'View incidents', checked: true }],
    change: [{ scope: 'incidents:write', label: 'Change incidents', checked: true }],
  },
];
const base = {
  action: async () => {},
  requestId: 'req-1',
  clientName: 'Claude',
  signedInAs: 'a@example.com',
  roleLabel: 'Admin',
  groups,
  hasUnavailable: false,
  writesEnabled: true,
  previousConnection: null,
  redirectWarning: false,
  timeZone: 'UTC',
};

describe('consent identity line', () => {
  it('shows the return host and the verifying host for a metadata-document client', () => {
    render(
      <ConsentView
        {...base}
        returnHost="localhost:51505"
        identity={{ kind: 'metadata', host: 'claude.ai', trusted: true }}
      />
    );
    const line = screen.getByTestId('mcp-consent-identity');
    expect(line.textContent).toContain('Returns to localhost:51505');
    expect(line.textContent).toContain('Identified by claude.ai');
    expect(screen.queryByText('Name not verified')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('Can make changes')).toBeTruthy();
  });
  it('flags a self-registered name and warns about a web redirect', () => {
    render(
      <ConsentView
        {...base}
        returnHost="evil.example"
        identity={{ kind: 'self-registered' }}
        redirectWarning
      />
    );
    expect(screen.getByText('Name not verified')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('evil.example');
  });
  it('says changes are off and replaces the badge when writes are disabled', () => {
    render(
      <ConsentView
        {...base}
        writesEnabled={false}
        returnHost="localhost:1"
        identity={{ kind: 'registered' }}
        previousConnection={{ createdAt: new Date('2026-10-01T00:00:00Z'), inUse: false }}
      />
    );
    expect(screen.getByRole('note').textContent).toContain('Changes are currently turned off');
    expect(screen.getByText('Changes off')).toBeTruthy();
    expect(screen.queryByText('Can make changes')).toBeNull();
    expect(screen.getByText(/Oct 1, 2026/).closest('p')?.textContent).toMatch(
      /replaces your unfinished sign-in from Oct 1, 2026/
    );
  });
  it('shows an untrusted metadata host as published, not verified (SEC-6)', () => {
    render(
      <ConsentView
        {...base}
        returnHost="claude-ai-connect.example"
        identity={{ kind: 'metadata', host: 'claude-ai-connect.example', trusted: false }}
      />
    );
    const line = screen.getByTestId('mcp-consent-identity');
    expect(line.textContent).toContain('Published by claude-ai-connect.example');
    expect(line.textContent).not.toContain('Identified by');
    expect(line.querySelector('svg')).toBeNull();
    expect(screen.getByText(/has not listed that site as trusted/)).toBeTruthy();
  });
  it('warns when a metadata client returns to another site', () => {
    render(
      <ConsentView
        {...base}
        returnHost="evil.example"
        identity={{ kind: 'metadata', host: 'claude.ai', trusted: true }}
        redirectWarning
      />
    );
    expect(screen.getByRole('note').textContent).toContain(
      'published by claude.ai but sends you to evil.example'
    );
  });
  it('never says an in-use connection is replaced (D3)', () => {
    render(
      <ConsentView
        {...base}
        returnHost="localhost:1"
        identity={{ kind: 'registered' }}
        previousConnection={{ createdAt: new Date('2026-10-01T00:00:00Z'), inUse: true }}
      />
    );
    expect(screen.queryByText(/replaces/)).toBeNull();
    expect(screen.getByText(/Oct 1, 2026/).closest('p')?.textContent).toMatch(
      /existing connection from Oct 1, 2026.* stays signed in/
    );
  });
  it('marks permissions an upgrade adds as New (D3)', () => {
    render(
      <ConsentView
        {...base}
        returnHost="localhost:1"
        identity={{ kind: 'registered' }}
        groups={[
          {
            id: 'incidents',
            label: 'Incidents',
            view: [{ scope: 'incidents:read', label: 'View incidents', checked: true }],
            change: [
              { scope: 'incidents:write', label: 'Change incidents', checked: false, added: true },
            ],
          },
        ]}
      />
    );
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getByText('New').closest('label')?.textContent).toContain('Change incidents');
  });
});

describe('UX-15 consent details', () => {
  it("shows the replaced connection in the person's own time zone", () => {
    render(
      <ConsentView
        {...base}
        timeZone="Asia/Kolkata"
        returnHost="localhost:1"
        identity={{ kind: 'registered' }}
        previousConnection={{ createdAt: new Date('2026-10-01T20:00:00Z'), inUse: false }}
      />
    );
    const time = screen.getByText(/Oct 2, 2026/);
    expect(time.textContent).toMatch(/1:30\s?AM/);
    expect(time.textContent).toMatch(/GMT\+5:30|IST/);
    expect(time.getAttribute('dateTime')).toBe('2026-10-01T20:00:00.000Z');
  });
  it('links straight to the connections list to disconnect', () => {
    render(<ConsentView {...base} returnHost="localhost:1" identity={{ kind: 'registered' }} />);
    expect(screen.getByRole('link', { name: 'disconnect any time' }).getAttribute('href')).toBe(
      '/settings/integrations/mcp?tab=connections'
    );
  });
  it('shows a brand icon only for a verified metadata host', () => {
    const { container, rerender } = render(
      <ConsentView {...base} returnHost="localhost:1" identity={{ kind: 'self-registered' }} />
    );
    const heading = () => screen.getByRole('heading', { level: 1 });
    expect(heading().querySelector('[aria-label="Anthropic Claude logo"]')).toBeNull();
    expect(heading().querySelector('svg')).not.toBeNull();
    rerender(
      <ConsentView
        {...base}
        returnHost="localhost:1"
        identity={{ kind: 'metadata', host: 'claude.ai', trusted: false }}
      />
    );
    // A host the administrator has not listed gets no brand logo (SEC-6).
    expect(container.querySelector('h1 [aria-label="Anthropic Claude logo"]')).toBeNull();
    rerender(
      <ConsentView
        {...base}
        returnHost="localhost:1"
        identity={{ kind: 'metadata', host: 'claude.ai', trusted: true }}
      />
    );
    expect(container.querySelector('h1 [aria-label="Anthropic Claude logo"]')).not.toBeNull();
  });
});

describe('assistant logos', () => {
  it('never shows a brand logo for a self-chosen name', () => {
    const { container, rerender } = render(<AssistantIcon name="Claude" />);
    expect(container.querySelector('[aria-label="Anthropic Claude logo"]')).toBeNull();
    rerender(<AssistantIcon name="Claude" verifiedHost="claude.ai.evil.example" />);
    expect(container.querySelector('[aria-label="Anthropic Claude logo"]')).toBeNull();
    rerender(<AssistantIcon name="Anything" verifiedHost="claude.ai" />);
    expect(container.querySelector('[aria-label="Anthropic Claude logo"]')).toBeTruthy();
  });
});
