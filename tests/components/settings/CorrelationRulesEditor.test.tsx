import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(app)/settings/intelligence/actions', () => ({
  previewCorrelationRules: vi.fn(),
  publishCorrelationRules: vi.fn(),
}));

import CorrelationRulesEditor from '@/components/settings/CorrelationRulesEditor';
import type { CorrelationRule } from '@/lib/intelligence/contract';

const existing: CorrelationRule = { id: 'db-errors', kind: 'CONTENT_TEMPLATE', enabled: true, keys: [], windowSeconds: 300, maxWindowSeconds: 900, minScore: 0.8 };

function setup(props: Partial<React.ComponentProps<typeof CorrelationRulesEditor>> = {}) {
  return render(<CorrelationRulesEditor initialRules={[existing]} headVersion={3} canManage maxLookbackDays={30} {...props} />);
}
const rulesJson = (container: HTMLElement) => JSON.parse((container.querySelector('input[name="rulesJson"]') as HTMLInputElement).value);

describe('CorrelationRulesEditor', () => {
  it('lists existing rules and carries them, and the head version, into both forms', () => {
    const { container } = setup();
    expect(screen.getByText(/db-errors/)).toBeInTheDocument();
    expect(rulesJson(container)).toHaveLength(1);
    expect(container.querySelector('input[name="expectedHeadVersion"]')).toHaveValue('3');
  });

  it('explains how to start when there are no rules', () => {
    setup({ initialRules: [] });
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument();
  });

  it('adds a valid rule and resets the draft', () => {
    const { container } = setup({ initialRules: [] });
    fireEvent.change(screen.getByLabelText('Rule id'), { target: { value: 'by-service' } });
    fireEvent.change(screen.getByLabelText('Group incidents with'), { target: { value: 'EXACT_FIELD' } });
    fireEvent.change(screen.getByLabelText('Keys'), { target: { value: 'Service, env' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    const [added] = rulesJson(container);
    expect(added).toMatchObject({ id: 'by-service', kind: 'EXACT_FIELD', keys: ['service', 'env'], enabled: true, windowSeconds: 300 });
    expect(screen.getByLabelText('Rule id')).toHaveValue('');
  });

  it.each([
    ['Bad Id!', 'CONTENT_TEMPLATE', '', /lowercase letters/],
    ['db-errors', 'CONTENT_TEMPLATE', '', /already exists/],
    ['needs-keys', 'LABEL_SET', '', /at least one key/],
  ])('rejects %s (%s) with a clear message', (id, kind, keys, message) => {
    const { container } = setup();
    fireEvent.change(screen.getByLabelText('Rule id'), { target: { value: id } });
    fireEvent.change(screen.getByLabelText('Group incidents with'), { target: { value: kind } });
    if (kind !== 'CONTENT_TEMPLATE') fireEvent.change(screen.getByLabelText('Keys'), { target: { value: keys } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(rulesJson(container)).toHaveLength(1);
  });

  it('rejects a maximum window shorter than the window', () => {
    setup({ initialRules: [] });
    fireEvent.change(screen.getByLabelText('Rule id'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Window (seconds)'), { target: { value: '600' } });
    fireEvent.change(screen.getByLabelText('Maximum window (seconds)'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/time window/);
  });

  it('removes and disables rules in the submitted payload', () => {
    const { container } = setup();
    fireEvent.click(screen.getByLabelText('Enabled'));
    expect(rulesJson(container)[0].enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(rulesJson(container)).toEqual([]);
  });

  it('is read-only without the manage capability', () => {
    setup({ canManage: false });
    expect(screen.getByText(/db-errors/)).toBeInTheDocument();
    for (const name of ['Add rule', 'Preview', 'Publish rules', 'Remove']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
