import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RunbookBuilder from '@/components/runbooks/RunbookBuilder';
import { newBuilderStep } from '@/lib/runbooks/builder';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';

vi.mock('@/components/ui/DetailTabs', () => ({
  default: ({ tabs }: { tabs: { id: string; content: ReactNode }[] }) => (
    <>
      {tabs.map(tab => (
        <div key={tab.id}>{tab.content}</div>
      ))}
    </>
  ),
}));
vi.mock('@/components/runbooks/RunbookControls', () => ({
  ActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form>,
  ConfigureSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SubmitButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  FormSelect: ({
    label,
    value,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={event => onValueChange(event.target.value)}>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(cleanup);

describe('Runbook nested check builder', () => {
  it('adds, edits, reorders and removes typed checks while preserving server-valid JSON', () => {
    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [newBuilderStep('MANUAL', 'action')] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );
    const before = screen.getByRole('region', { name: 'Before action checks' });
    fireEvent.click(within(before).getByRole('button', { name: 'Add precheck' }));
    fireEvent.change(within(before).getByLabelText('Step name'), {
      target: { value: 'Service exists' },
    });
    fireEvent.change(within(before).getByLabelText('Service unit or input reference'), {
      target: { value: 'payments.service' },
    });
    fireEvent.click(within(before).getAllByRole('button', { name: 'Add precheck' }).at(-1)!);
    fireEvent.click(
      within(before).getByRole('button', { name: 'Move Service exists down in Before action' })
    );
    const after = screen
      .getAllByRole('region', { name: 'After action checks' })
      .find(region => !before.contains(region))!;
    fireEvent.click(within(after).getByRole('button', { name: 'Add verification' }));
    fireEvent.change(within(after).getByLabelText('Step name'), {
      target: { value: 'Service recovered' },
    });
    const saved = () =>
      parseRunbookDefinition(
        JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
      );
    expect(saved().steps[0].precheck?.steps.map(step => step.name)).toEqual([
      'Systemd',
      'Service exists',
    ]);
    expect(saved().steps[0].verification?.steps[0].name).toBe('Service recovered');
    fireEvent.click(
      within(before).getByRole('button', { name: 'Remove Service exists from Before action' })
    );
    expect(saved().steps[0].precheck?.steps).toHaveLength(1);
    fireEvent.click(
      within(before).getByRole('button', { name: 'Remove Systemd from Before action' })
    );
    expect(saved().steps[0].precheck).toBeUndefined();
  });

  it('keeps published definitions read-only and summarizes existing checks', () => {
    const action = newBuilderStep('MANUAL', 'action');
    action.precheck = { steps: [newBuilderStep('SYSTEMD', 'before')] };
    render(
      <RunbookBuilder
        initialDefinition={{ steps: [action] }}
        initialInputs={[]}
        action={async () => {}}
        readOnly
      />
    );
    expect(screen.queryByRole('button', { name: 'Add precheck' })).toBeNull();
    expect(screen.getByText(/Before: Systemd/)).toBeTruthy();
  });

  it('renders draftRevision hidden input and initializes from prop', () => {
    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [newBuilderStep('MANUAL', 'action')] }}
        initialInputs={[]}
        initialDraftRevision={42}
        action={async () => {}}
      />
    );
    const revisionInput = container.querySelector(
      'input[name="draftRevision"]'
    ) as HTMLInputElement;
    expect(revisionInput).toBeTruthy();
    expect(revisionInput.value).toBe('42');
  });
});
