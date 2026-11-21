import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/settings/intelligence/actions', () => ({
  saveIntelligenceSettings: vi.fn(),
  publishGlobalPolicy: vi.fn(),
  publishTriagePolicy: vi.fn(),
  rollbackGlobalPolicy: vi.fn(),
  replayIntelligenceDeadLetter: vi.fn(),
}));

import {
  IntelligencePolicyForm,
  IntelligenceSettingsForm,
  ReplayForm,
  RollbackForm,
  TriagePolicyForm,
} from '@/components/settings/IntelligenceSettingsForms';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';

const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 3 };

describe('IntelligenceSettingsForm', () => {
  it('lets a manager edit and submit, carrying the revision for optimistic locking', () => {
    const { container } = render(<IntelligenceSettingsForm settings={settings} canManage />);
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    expect(container.querySelector('input[name="expectedRevision"]')).toHaveValue('3');
    expect(screen.getByLabelText('Enable OpsKnight Intelligence')).not.toBeChecked();
    expect(screen.getByLabelText('Candidates per source')).toHaveValue(50);
  });

  it('is read-only without the manage capability and shows no submit button', () => {
    render(
      <IntelligenceSettingsForm settings={{ ...settings, enabled: true }} canManage={false} />
    );
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Enable OpsKnight Intelligence')).toBeChecked();
    expect(screen.getByLabelText('Enable OpsKnight Intelligence')).toBeDisabled();
    expect(screen.getByLabelText('Batch size')).toBeDisabled();
  });

  it('exposes the documented limits as input bounds', () => {
    render(<IntelligenceSettingsForm settings={settings} canManage />);
    const concurrency = screen.getByLabelText('Concurrent work items');
    expect(concurrency).toHaveAttribute('min', '1');
    expect(concurrency).toHaveAttribute('max', '16');
  });
});

describe('IntelligencePolicyForm', () => {
  const props = {
    headVersion: 2,
    mode: 'SHADOW' as const,
    similarityEnabled: true,
    responseEnabled: true,
    minScore: 0.35,
    canManage: true,
  };

  it('keeps AUTO unselectable until it is certified', () => {
    render(<IntelligencePolicyForm {...props} autoAvailable={false} />);
    const auto = screen.getByRole('option', { name: /Automatic/ });
    expect(auto).toBeDisabled();
    expect(auto).toHaveTextContent('not available until certified');
    expect(screen.getByLabelText('Mode')).toHaveValue('SHADOW');
  });

  it('carries the head version so concurrent edits are detected', () => {
    const { container } = render(<IntelligencePolicyForm {...props} autoAvailable={false} />);
    expect(container.querySelector('input[name="expectedHeadVersion"]')).toHaveValue('2');
  });

  it('is read-only for non-managers', () => {
    render(<IntelligencePolicyForm {...props} canManage={false} autoAvailable={false} />);
    expect(screen.queryByRole('button', { name: 'Publish new version' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mode')).toBeDisabled();
  });
});

describe('TriagePolicyForm', () => {
  it('is its own form: one switch, the head version, and a save button for managers', () => {
    const { container } = render(<TriagePolicyForm headVersion={4} enabled canManage />);
    expect(screen.getByLabelText(/Suggest triage/)).toBeChecked();
    expect(container.querySelector('input[name="expectedHeadVersion"]')).toHaveValue('4');
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save triage setting' })).toBeEnabled();
  });

  it('is read-only for non-managers', () => {
    render(<TriagePolicyForm headVersion={4} enabled={false} canManage={false} />);
    expect(screen.getByLabelText(/Suggest triage/)).not.toBeChecked();
    expect(screen.getByLabelText(/Suggest triage/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save triage setting' })).not.toBeInTheDocument();
  });

  it('is no longer a checkbox inside the global policy form', () => {
    const { container } = render(
      <IntelligencePolicyForm
        headVersion={2}
        mode="SHADOW"
        similarityEnabled
        responseEnabled
        minScore={0.35}
        canManage
        autoAvailable={false}
      />
    );
    expect(container.querySelector('input[name="triageEnabled"]')).toBeNull();
  });
});

describe('history and replay controls', () => {
  it('requires a reason to restore an earlier version', () => {
    const { container } = render(<RollbackForm targetVersion={1} headVersion={3} />);
    expect(container.querySelector('input[name="targetVersion"]')).toHaveValue('1');
    expect(container.querySelector('input[name="expectedHeadVersion"]')).toHaveValue('3');
    expect(screen.getByLabelText('Reason for restoring version 1')).toBeRequired();
  });

  it('offers a retry for a dead letter', () => {
    const { container } = render(<ReplayForm id="work-1" />);
    expect(container.querySelector('input[name="id"]')).toHaveValue('work-1');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
