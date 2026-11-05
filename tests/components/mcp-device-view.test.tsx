import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceView from '@/app/oauth/mcp/device/DeviceView';
import ConsentView from '@/app/oauth/mcp/consent/ConsentView';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
afterEach(cleanup);

const action = async () => {};
const WARNING = 'Only continue if you started this sign-in yourself on a device you control.';

describe('device verification page states', () => {
  it('empty entry: asks for the code, warns, and has an explicit Continue', () => {
    render(
      <DeviceView
        state={{ kind: 'enter', userCode: '', error: null, signedInAs: 'a@example.com' }}
        action={action}
      />
    );
    expect(screen.getByRole('heading', { name: 'Connect a device' })).toBeTruthy();
    expect(screen.getByText(/Enter the code shown on your device/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain(WARNING);
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.name).toBe('user_code');
    expect(input.autocomplete).toBe('off');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('prefilled from the complete link: shows the code to compare, still needs Continue', () => {
    render(
      <DeviceView
        state={{ kind: 'enter', userCode: 'BCDF-GHJK', error: null, signedInAs: 'a@example.com' }}
        action={action}
      />
    );
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('BCDF-GHJK');
    expect(
      screen.getByText(/Check that this code matches the one shown on your device/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it.each([
    ['MCP_DEVICE_CODE_INVALID', 'That code did not work'],
    ['MCP_DEVICE_CODE_LOCKED', 'Too many wrong codes'],
    ['MCP_DEVICE_CODE_EXPIRED', 'This code expired or was already used'],
  ])('shows %s as an alert without echoing the typed code', (code, title) => {
    render(
      <DeviceView
        state={{ kind: 'enter', userCode: '', error: code, signedInAs: 'a@example.com' }}
        action={action}
      />
    );
    expect(screen.getByTestId('mcp-device-error').textContent).toContain(title);
  });

  it('approved and denied end states', () => {
    const { unmount } = render(<DeviceView state={{ kind: 'approved' }} action={action} />);
    expect(screen.getByRole('heading', { name: 'Device connected' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Return to your device');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    render(<DeviceView state={{ kind: 'denied' }} action={action} />);
    expect(screen.getByRole('heading', { name: 'Sign-in cancelled' })).toBeTruthy();
    expect(screen.queryByText(/disconnect it any time/)).toBeNull();
  });

  it('unavailable: explains why and offers no form', () => {
    render(
      <DeviceView
        state={{ kind: 'unavailable', code: 'MCP_DEVICE_FLOW_DISABLED' }}
        action={action}
      />
    );
    expect(screen.getByRole('heading', { name: 'Device sign-in is turned off' })).toBeTruthy();
    expect(screen.queryByLabelText('Code')).toBeNull();
  });

  it('the consent step of a device sign-in warns and names no return address', () => {
    render(
      <ConsentView
        action={action}
        requestId="dev-1"
        clientName="ops-cli"
        signedInAs="a@example.com"
        roleLabel="Admin"
        groups={[
          {
            id: 'incidents',
            label: 'Incidents',
            view: [{ scope: 'incidents:read', label: 'View incidents', checked: true }],
            change: [],
          },
        ]}
        hasUnavailable={false}
        returnHost={null}
        identity={{ kind: 'self-registered' }}
        redirectWarning={false}
        writesEnabled
        previousConnection={null}
        timeZone="UTC"
        device
      />
    );
    expect(screen.getByTestId('mcp-device-warning').textContent).toContain(WARNING);
    expect(screen.getByTestId('mcp-consent-identity').textContent).toContain(
      'Signs in another device'
    );
    expect(screen.getByTestId('mcp-consent-identity').textContent).not.toContain('Returns to');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
  });
});
