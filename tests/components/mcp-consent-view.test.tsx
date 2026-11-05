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
    expect(screen.getByText(/replaces your unfinished sign-in from Oct 1, 2026/)).toBeTruthy();
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
    expect(screen.getByText(/existing connection from Oct 1, 2026 stays signed in/)).toBeTruthy();
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
