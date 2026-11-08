import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  save: vi.fn(async () => ({ ok: true, message: 'Connection added.' })),
  remove: vi.fn(async () => ({ ok: true, message: 'Connection removed.' })),
  test: vi.fn(async () => ({ ok: true, message: 'Connected in 12 ms.' })),
}));
vi.mock('@/app/(app)/settings/intelligence/connections/actions', () => ({
  saveConnectionAction: actions.save,
  deleteConnectionAction: actions.remove,
  testConnectionAction: actions.test,
}));
import {
  ConnectionForm,
  DeleteConnectionButton,
  TestConnectionButton,
} from '@/components/settings/ObservabilityConnectionForms';
import type { ObservabilityConnectionView } from '@/lib/intelligence/connectors/contract';

const teams = [
  { id: 't1', name: 'Payments' },
  { id: 't2', name: 'Search' },
];

const saved: ObservabilityConnectionView = {
  id: 'c1',
  name: 'Prod Prometheus',
  kind: 'PROMETHEUS',
  baseUrl: 'https://prom.example.com',
  region: null,
  org: null,
  project: null,
  allowedTeamIds: ['t2'],
  allowPrivateNetwork: false,
  enabled: true,
  timeoutMs: 5000,
  hasCredential: true,
  updatedAt: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  actions.save.mockClear();
  actions.remove.mockClear();
  actions.test.mockClear();
});

describe('ConnectionForm', () => {
  it('adds a connection that is disabled by default, with selected teams', async () => {
    render(<ConnectionForm teams={teams} canManage />);
    expect(screen.getByLabelText(/^Enabled/)).not.toBeChecked();
    expect(screen.getByLabelText(/Allow a private-network address/)).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Prom' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://prom.example.com' },
    });
    fireEvent.click(screen.getByLabelText('Payments'));
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    const form = (actions.save.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(form.get('kind')).toBe('PROMETHEUS');
    expect(form.getAll('allowedTeamIds')).toEqual(['t1']);
    expect(form.get('enabled')).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent('Connection added.');
  });

  it('shows kind-specific fields and never pre-fills a stored credential', () => {
    render(<ConnectionForm connection={saved} teams={teams} canManage />);
    const secret = screen.getByLabelText(/Bearer token or password/) as HTMLInputElement;
    expect(secret.type).toBe('password');
    expect(secret.value).toBe('');
    expect(screen.getByText(/A credential is stored/)).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeChecked();

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'CLOUDWATCH' } });
    expect(screen.getByLabelText('AWS region')).toBeInTheDocument();
    expect(screen.queryByLabelText('Base URL')).toBeNull();
    expect(screen.getByLabelText('Access key ID')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Allow a private-network address/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'SENTRY' } });
    expect(screen.getByLabelText('Organization slug')).toBeRequired();
    expect(screen.getByText(/Answers: error events/)).toBeInTheDocument();
  });

  it('is read-only without the manage permission', () => {
    render(<ConnectionForm connection={saved} teams={teams} canManage={false} />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Update connection' })).toBeNull();
  });
});

describe('connection buttons', () => {
  it('requires explicit confirmation before removing a connection', async () => {
    render(<DeleteConnectionButton id="c1" name="Prod Prometheus" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Prod Prometheus' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Prod Prometheus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledTimes(1));
    expect((actions.remove.mock.calls[0] as unknown as [unknown, FormData])[1].get('id')).toBe(
      'c1'
    );
  });

  it('runs a test read and shows the result', async () => {
    render(<TestConnectionButton id="c1" name="Prod Prometheus" />);
    fireEvent.click(screen.getByRole('button', { name: 'Test Prod Prometheus' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Connected in 12 ms.');
    expect((actions.test.mock.calls[0] as unknown as [unknown, FormData])[1].get('id')).toBe('c1');
  });
});
