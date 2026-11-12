import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import McpCapabilityScopedControls, {
  type McpCapabilityScopeOption,
} from '@/app/(app)/settings/integrations/mcp/components/McpCapabilityScopedControls';
import type { McpCapability } from '@/lib/mcp/catalog/capabilities';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const capability = (id: string): McpCapability => ({
  id,
  kind: 'operation',
  domain: 'incidents',
  risk: 'R0',
  tool: null,
  curated: false,
  approval: false,
  read: true,
  summary: `${id} summary`,
});
const capabilities = [capability('listIncidents'), capability('getIncident')];
const scopes: McpCapabilityScopeOption[] = [
  { value: 'global', label: 'All roles', scope: { kind: 'global' }, disabled: [] },
  {
    value: 'role:USER',
    label: 'User',
    scope: { kind: 'role', role: 'USER' },
    disabled: ['getIncident'],
  },
  {
    value: 'client:c1',
    label: 'Claude',
    scope: { kind: 'client', clientId: 'c1' },
    disabled: [],
  },
];

const exposed = () => screen.getByText(/capabilities exposed/).textContent ?? '';
const scopeSelect = () => screen.getByRole('combobox', { name: 'Restrictions for' });

function pick(name: string) {
  fireEvent.keyDown(scopeSelect(), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name }));
}

function toggle(id: string) {
  // A search expands the matching domain so the capability's own switch is reachable.
  fireEvent.change(screen.getByLabelText('Filter capabilities'), { target: { value: id } });
  fireEvent.click(screen.getByRole('switch', { name: `Expose ${id}` }));
}

function renderControls() {
  const action = vi.fn(async (input: { disabled: string[] }) => ({
    ok: true as const,
    disabled: input.disabled,
    added: input.disabled,
    removed: [],
  }));
  render(
    <McpCapabilityScopedControls capabilities={capabilities} scopes={scopes} action={action} />
  );
  return action;
}

it('shows each scope its own stored list and description', () => {
  renderControls();
  expect(exposed()).toContain('2 of 2');
  pick('Role: User');
  expect(exposed()).toContain('1 of 2');
  expect(screen.getByText(/people whose role is User/)).toBeTruthy();
  pick('Claude');
  expect(exposed()).toContain('2 of 2');
  expect(screen.getByText(/everyone who uses Claude/)).toBeTruthy();
});

it('saves to the selected scope and keeps the saved list when switching back', async () => {
  const action = renderControls();
  pick('Claude');
  toggle('listIncidents');
  // Unsaved edits lock the scope selector so they cannot be lost by switching.
  expect(scopeSelect()).toHaveProperty('disabled', true);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save capabilities' }));
  });
  expect(action).toHaveBeenCalledWith({
    disabled: ['listIncidents'],
    baseline: [],
    scope: { kind: 'client', clientId: 'c1' },
  });
  await waitFor(() => expect(scopeSelect()).toHaveProperty('disabled', false));
  pick('All roles');
  expect(exposed()).toContain('2 of 2');
  pick('Claude');
  expect(exposed()).toContain('1 of 2');
});

it('sends the role scope with its baseline', async () => {
  const action = renderControls();
  pick('Role: User');
  toggle('getIncident');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save capabilities' }));
  });
  expect(action).toHaveBeenCalledWith({
    disabled: [],
    baseline: ['getIncident'],
    scope: { kind: 'role', role: 'USER' },
  });
});
