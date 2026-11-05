import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpCapabilityControlsPanel from '@/app/(app)/settings/integrations/mcp/components/McpCapabilityControlsPanel';
import type { McpCapability } from '@/lib/mcp/catalog/capabilities';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const capability = (id: string, domain: string): McpCapability => ({
  id,
  kind: 'operation',
  domain,
  risk: 'R0',
  tool: null,
  curated: false,
  approval: false,
  read: true,
  summary: `${id} summary`,
});
const capabilities = [
  capability('listIncidents', 'incidents'),
  capability('getIncident', 'incidents'),
  capability('listServices', 'services'),
];

function renderPanel() {
  const action = vi.fn();
  render(
    <McpCapabilityControlsPanel
      capabilities={capabilities}
      initialDisabled={[]}
      action={action as never}
    />
  );
  return action;
}
const exposed = () => screen.getByText(/capabilities exposed/).textContent ?? '';

it('asks before disabling every capability, and changes nothing if cancelled', () => {
  const action = renderPanel();
  expect(exposed()).toContain('3 of 3');
  fireEvent.click(screen.getByRole('button', { name: 'Uncheck all capabilities' }));
  expect(screen.getByRole('alertdialog', { name: 'Disable all 3 capabilities?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Keep current selection' }));
  expect(exposed()).toContain('3 of 3');
  expect(action).not.toHaveBeenCalled();
});

it('disables all only after confirming, and still waits for Save', () => {
  const action = renderPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Uncheck all capabilities' }));
  fireEvent.click(screen.getByRole('button', { name: 'Disable all' }));
  expect(exposed()).toContain('0 of 3');
  expect(action).not.toHaveBeenCalled();
});

const mixed: McpCapability[] = [
  capability('listIncidents', 'incidents'),
  { ...capability('acknowledgeIncident', 'incidents'), risk: 'R1', read: false },
  capability('listServices', 'services'),
  { ...capability('deleteService', 'services'), risk: 'R3', read: false, approval: true },
];
function renderMixed(initialDisabled: string[] = []) {
  const action = vi.fn().mockResolvedValue({ ok: true, disabled: [], added: [], removed: [] });
  render(
    <McpCapabilityControlsPanel
      capabilities={mixed}
      initialDisabled={initialDisabled}
      action={action as never}
    />
  );
  return action;
}
const search = (value: string) =>
  fireEvent.change(screen.getByLabelText('Filter capabilities'), { target: { value } });

it('UX-12: bulk disable under a filter only touches the capabilities shown', async () => {
  const action = renderMixed();
  search('service');
  const disable = await screen.findByRole('button', { name: 'Disable the 2 capabilities shown' });
  fireEvent.click(disable);
  expect(
    screen.getByRole('alertdialog', { name: 'Disable the 2 capabilities shown?' })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Disable shown' }));
  expect(exposed()).toContain('2 of 4');
  fireEvent.click(screen.getByRole('button', { name: 'Save capabilities' }));
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(action.mock.calls[0][0].disabled).toEqual(['deleteService', 'listServices']);
});

it('UX-12: bulk expose under a filter keeps the rest of a disabled domain off', async () => {
  const action = renderMixed(['domain:services', 'domain:incidents']);
  expect(exposed()).toContain('0 of 4');
  search('listServices');
  fireEvent.click(await screen.findByRole('button', { name: 'Expose the 1 capabilities shown' }));
  expect(exposed()).toContain('1 of 4');
  fireEvent.click(screen.getByRole('button', { name: 'Save capabilities' }));
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(action.mock.calls[0][0].disabled).toEqual(['deleteService', 'domain:incidents']);
});

it('UX-12: the view-only preset turns off every change and keeps every read', async () => {
  const action = renderMixed(['listServices']);
  fireEvent.click(screen.getByRole('button', { name: 'View-only preset' }));
  expect(exposed()).toContain('2 of 4');
  fireEvent.click(screen.getByRole('button', { name: 'Save capabilities' }));
  await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(action.mock.calls[0][0].disabled).toEqual(['acknowledgeIncident', 'deleteService']);
});

it('UX-13: unsaved capability changes ask before a reload', () => {
  renderMixed();
  const blocked = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(blocked()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'View-only preset' }));
  expect(blocked()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(blocked()).toBe(false);
});
