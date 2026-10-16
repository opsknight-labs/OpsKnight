import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  search: vi.fn(),
  load: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
vi.mock('@/components/incident/runbook-actions', () => ({
  searchAdhocIncidentRunbooksAction: actions.search,
  loadAdhocIncidentRunbookAction: actions.load,
  previewAdhocIncidentRunbookAction: actions.preview,
  executeAdhocIncidentRunbookAction: actions.execute,
}));
vi.mock('@/components/runbooks/RunbookTargetSelect', () => ({
  default: () => (
    <select name="executionTarget" aria-label="Execution target" defaultValue="none">
      <option value="none">No Agent target</option>
      <option value="agent:cagent0000001">edge-1</option>
    </select>
  ),
}));
vi.mock('@/components/runbooks/RunbookExecutionPreview', () => ({
  default: function PreviewStub({
    previewAction,
    executeAction,
  }: {
    previewAction: () => Promise<unknown>;
    executeAction: (data: FormData) => Promise<{ error?: string } | void>;
  }) {
    const [result, setResult] = useState('');
    return (
      <div>
        <button type="button" onClick={() => void previewAction()}>
          Preview execution
        </button>
        <button
          type="button"
          onClick={async () => {
            const data = new FormData();
            data.set('previewDigest', 'a'.repeat(64));
            data.set('previewAuthorizationToken', 'b'.repeat(64));
            const response = await executeAction(data);
            setResult(response?.error ?? 'started');
          }}
        >
          Execute this plan
        </button>
        <output aria-label="Execute result">{result}</output>
      </div>
    );
  },
}));

import AdhocRunbookLauncher from '@/components/incident/runbooks/AdhocRunbookLauncher';

const RUNBOOK = {
  id: 'crunbook00001',
  name: 'Restart API',
  description: 'Restarts the API unit',
  version: 4,
  inputs: [
    {
      key: 'unit',
      label: 'Unit',
      type: 'STRING',
      required: true,
      defaultValue: null,
      description: '',
      options: [],
    },
    {
      key: 'replicas',
      label: 'Replicas',
      type: 'NUMBER',
      required: false,
      defaultValue: null,
      description: '',
      options: [],
    },
  ],
  requiresAgent: true,
  hasAgentWrite: true,
  hasWrite: true,
};

async function openAndSelect() {
  render(<AdhocRunbookLauncher incidentId="cincident0001" />);
  fireEvent.click(screen.getByRole('button', { name: 'Run another runbook' }));
  const option = await screen.findByRole('button', { name: /Restart API/ });
  await act(async () => {
    fireEvent.click(option);
  });
  await screen.findByRole('region', { name: 'Run configuration' });
}

const unitInput = () => document.querySelector('input[name="input:unit"]') as HTMLInputElement;

describe('AdhocRunbookLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.search.mockResolvedValue([
      { id: RUNBOOK.id, name: RUNBOOK.name, description: RUNBOOK.description, version: 4 },
    ]);
    actions.load.mockResolvedValue({ runbook: RUNBOOK, targets: { agents: [], pools: [] } });
    actions.preview.mockResolvedValue({ preview: undefined });
    actions.execute.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('shows a helpful empty state when no published runbooks exist', async () => {
    actions.search.mockResolvedValue([]);
    render(<AdhocRunbookLauncher incidentId="cincident0001" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run another runbook' }));
    expect(await screen.findByText(/No published runbooks yet/)).toBeTruthy();
    expect(actions.search).toHaveBeenCalledWith('cincident0001', '');
  });

  it('renders published inputs, target and write warning for the chosen runbook', async () => {
    await openAndSelect();
    expect(actions.load).toHaveBeenCalledWith('cincident0001', RUNBOOK.id);
    expect(screen.getByText('Published v4')).toBeTruthy();
    expect(screen.getByText('Contains write actions')).toBeTruthy();
    expect(unitInput()).toBeTruthy();
    expect((document.querySelector('input[name="input:replicas"]') as HTMLInputElement).type).toBe(
      'number'
    );
    expect(screen.getByRole('combobox', { name: 'Execution target' })).toBeTruthy();
    expect(screen.getByText(/Agent-executed steps/)).toBeTruthy();
  });

  it('previews and executes exactly the previewed inputs and target', async () => {
    await openAndSelect();
    fireEvent.change(unitInput(), { target: { value: 'api.service' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Execution target' }), {
      target: { value: 'agent:cagent0000001' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Preview execution' }));
    });
    const [incidentId, runbookId, previewData] = actions.preview.mock.calls[0] as [
      string,
      string,
      FormData,
    ];
    expect([incidentId, runbookId]).toEqual(['cincident0001', RUNBOOK.id]);
    expect(previewData.get('input:unit')).toBe('api.service');
    expect(previewData.get('executionTarget')).toBe('agent:cagent0000001');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Execute this plan' }));
    });
    const executeData = actions.execute.mock.calls[0][2] as FormData;
    expect(executeData.get('previewDigest')).toBe('a'.repeat(64));
    expect(executeData.get('previewAuthorizationToken')).toBe('b'.repeat(64));
    expect(executeData.get('input:unit')).toBe('api.service');
    expect(executeData.get('executionTarget')).toBe('agent:cagent0000001');
  });

  it('refuses to execute when inputs changed after preview', async () => {
    await openAndSelect();
    fireEvent.change(unitInput(), { target: { value: 'api.service' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Preview execution' }));
    });
    fireEvent.change(unitInput(), { target: { value: 'db.service' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Execute this plan' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Execute result' }).textContent).toMatch(
        /changed after preview/
      )
    );
    expect(actions.execute).not.toHaveBeenCalled();
  });

  it('shows load errors without rendering a run form', async () => {
    actions.load.mockResolvedValue({ error: 'Runbook is not published or was archived.' });
    render(<AdhocRunbookLauncher incidentId="cincident0001" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run another runbook' }));
    const option = await screen.findByRole('button', { name: /Restart API/ });
    await act(async () => {
      fireEvent.click(option);
    });
    expect(await screen.findByText('Runbook is not published or was archived.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Run configuration' })).toBeNull();
  });
});
