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
