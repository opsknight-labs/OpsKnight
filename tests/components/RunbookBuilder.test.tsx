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

  it('handles numeric fields safely: clearing replicas deletes key and explicit 0 sets 0', () => {
    const k8sStep = {
      ...newBuilderStep('KUBERNETES', 'scale_step'),
      config: {
        action: 'scale',
        namespace: 'prod',
        resource: 'deployment',
        name: 'web-service',
        replicas: 3,
      },
      riskClass: 'IDEMPOTENT_WRITE' as const,
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [k8sStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const replicasInput = screen.getByLabelText(
      'Desired replicas (Agent policy is authoritative)'
    ) as HTMLInputElement;
    expect(replicasInput.value).toBe('3');

    // Clearing the field must delete the key, NOT evaluate to 0
    fireEvent.change(replicasInput, { target: { value: '' } });
    const rawSaved = JSON.parse(
      (container.querySelector('input[name="definition"]') as HTMLInputElement).value
    );
    expect(rawSaved.steps[0].config.replicas).toBeUndefined();
    expect(screen.getByText('Desired replicas is required for scale action.')).toBeTruthy();

    // Explicitly entering 0 must set replicas to 0 (scale-to-zero) and be server-valid
    fireEvent.change(replicasInput, { target: { value: '0' } });
    const zeroSaved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(zeroSaved.steps[0].config.replicas).toBe(0);
  });

  it('strips replicas when switching Kubernetes action away from scale', () => {
    const k8sStep = {
      ...newBuilderStep('KUBERNETES', 'scale_step'),
      config: {
        action: 'scale',
        namespace: 'prod',
        resource: 'deployment',
        name: 'web-service',
        replicas: 5,
      },
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [k8sStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const actionSelect = screen.getByLabelText('Action');
    fireEvent.change(actionSelect, { target: { value: 'rollout-restart' } });

    const saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].config.action).toBe('rollout-restart');
    expect(saved.steps[0].config.replicas).toBeUndefined();
  });

  it('demotes risk and unlocks approval when switching from non-idempotent to read-only action', () => {
    const restartStep = {
      ...newBuilderStep('SYSTEMD', 'svc_step'),
      config: {
        action: 'restart',
        unit: 'payment.service',
      },
      riskClass: 'NON_IDEMPOTENT' as const,
      requiresApproval: true,
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [restartStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const actionSelect = screen.getByLabelText('Action');
    fireEvent.change(actionSelect, { target: { value: 'status' } });

    const saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].config.action).toBe('status');
    expect(saved.steps[0].riskClass).toBe('READ_ONLY');
    expect(saved.steps[0].requiresApproval).toBe(false);
  });

  it('duplicates step with fresh unique key', () => {
    const initialStep = newBuilderStep('MANUAL', 'first_action');
    initialStep.name = 'Initial Manual Step';

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [initialStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const duplicateBtn = screen.getByRole('button', { name: 'Duplicate Initial Manual Step' });
    fireEvent.click(duplicateBtn);

    const saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps).toHaveLength(2);
    expect(saved.steps[1].key).not.toBe(saved.steps[0].key);
    expect(saved.steps[1].key).toContain('first_action_copy');
    expect(saved.steps[1].name).toBe('Initial Manual Step (Copy)');
  });

  it('displays inline validation error when step name is empty', () => {
    const initialStep = newBuilderStep('MANUAL', 'test_step');

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [initialStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const nameInput = screen.getByLabelText('Step name');
    fireEvent.change(nameInput, { target: { value: '' } });

    expect(screen.getByText('Step name is required.')).toBeTruthy();
  });
});

