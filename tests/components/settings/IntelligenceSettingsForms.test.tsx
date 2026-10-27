import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/settings/intelligence/actions', () => ({
  saveIntelligenceSettings: vi.fn(),
  publishGlobalPolicy: vi.fn(),
  rollbackGlobalPolicy: vi.fn(),
  replayIntelligenceDeadLetter: vi.fn(),
}));

import {
  IntelligencePolicyForm,
  IntelligenceSettingsForm,
  ReplayForm,
  RollbackForm,
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
    render(<IntelligenceSettingsForm settings={{ ...settings, enabled: true }} canManage={false} />);
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
  const props = { headVersion: 2, mode: 'SHADOW' as const, similarityEnabled: true, responseEnabled: true, minScore: 0.35, canManage: true };

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
