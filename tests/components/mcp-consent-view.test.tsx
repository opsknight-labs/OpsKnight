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
  replacesConnectionFrom: null,
  redirectWarning: false,
  timeZone: 'UTC',
};

describe('consent identity line', () => {
  it('shows the return host and the verifying host for a metadata-document client', () => {
    render(
      <ConsentView
        {...base}
        returnHost="localhost:51505"
        identity={{ kind: 'metadata', host: 'claude.ai' }}
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
        replacesConnectionFrom={new Date('2026-10-01T00:00:00Z')}
      />
    );
    expect(screen.getByRole('note').textContent).toContain('Changes are currently turned off');
    expect(screen.getByText('Changes off')).toBeTruthy();
    expect(screen.queryByText('Can make changes')).toBeNull();
    expect(screen.getByText(/Oct 1, 2026/).closest('p')?.textContent).toContain(
      'replaces your connection from Oct 1, 2026'
    );
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
        replacesConnectionFrom={new Date('2026-10-01T20:00:00Z')}
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
        identity={{ kind: 'metadata', host: 'claude.ai' }}
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
