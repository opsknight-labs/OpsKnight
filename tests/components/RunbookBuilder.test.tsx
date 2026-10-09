import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RunbookBuilder from '@/components/runbooks/RunbookBuilder';
import { newBuilderStep } from '@/lib/runbooks/builder';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';
import { validateRunbook, validateStep } from '@/components/runbooks/builder/validation';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

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

  it('validates that disk diagnostics does not require path while filesystem requires path', () => {
    const diskStep = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'disk_check'),
      config: { diagnostic: 'disk' },
    };
    const diskResult = validateStep(diskStep);
    expect(diskResult.isValid).toBe(true);
    expect(diskResult.errors.path).toBeUndefined();

    const fsStep = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'fs_check'),
      config: { diagnostic: 'filesystem' },
    };
    const fsResult = validateStep(fsStep);
    expect(fsResult.isValid).toBe(false);
    expect(fsResult.errors.path).toBe('Filesystem path is required.');
  });

  it('reports input validation errors in validateRunbook and readiness summary', () => {
    const validStep = newBuilderStep('MANUAL', 'step_1');
    const invalidInputs: RunbookInputInput[] = [
      { key: 'INVALID KEY WITH SPACES', label: 'My Param', description: '', type: 'STRING', required: false, sequence: 0 },
      { key: 'duplicate_key', label: 'First', description: '', type: 'STRING', required: false, sequence: 1 },
      { key: 'duplicate_key', label: 'Second', description: '', type: 'STRING', required: false, sequence: 2 },
    ];

    const result = validateRunbook({ steps: [validStep] }, invalidInputs);
    expect(result.hasErrors).toBe(true);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.inputErrors.size).toBeGreaterThan(0);
  });

  it('detects duplicate step keys across flattened nested checks', () => {
    const stepWithPrecheck = {
      ...newBuilderStep('MANUAL', 'parent_step'),
      precheck: {
        steps: [
          newBuilderStep('SYSTEMD', 'shared_key'),
        ],
      },
    };
    const secondStep = newBuilderStep('WAIT', 'shared_key');

    const result = validateRunbook({ steps: [stepWithPrecheck, secondStep] }, []);
    expect(result.hasErrors).toBe(true);
    expect(result.stepErrors.get(1)?.key).toBe('Step key must be unique across the runbook.');
  });

  it('isolates Kubernetes resourceName error and does not render under Step name', () => {
    const k8sStep = {
      ...newBuilderStep('KUBERNETES', 'k8s_action'),
      name: 'Valid Step Name',
      config: { action: 'rollout-restart', namespace: 'prod', resource: 'deployment', name: '' },
    };

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [k8sStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const resourceError = screen.getByText('Resource name is required for Kubernetes rollout-restart.');
    expect(resourceError).toBeTruthy();

    const stepNameInput = screen.getByLabelText('Step name');
    expect(stepNameInput.classList.contains('border-destructive')).toBe(false);
    expect(screen.queryByText('Step name is required.')).toBeNull();
  });

  it('retains input key focus and state during key editing without unmounting', () => {
    const initialInput: RunbookInputInput = {
      key: 'service_name',
      label: 'Target Service',
      description: 'The target service to restart',
      type: 'STRING',
      required: true,
      sequence: 0,
    };

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [newBuilderStep('MANUAL', 'step_1')] }}
        initialInputs={[initialInput]}
        action={async () => {}}
      />
    );

    const inputKeyField = screen.getByLabelText('Input 1 key') as HTMLInputElement;
    inputKeyField.focus();
    expect(document.activeElement).toBe(inputKeyField);

    fireEvent.change(inputKeyField, { target: { value: 'updated_service_name' } });
    expect(inputKeyField.value).toBe('updated_service_name');
    expect(document.activeElement).toBe(inputKeyField);
  });

  it('preserves active step selection when moving another step', () => {
    const step1 = { ...newBuilderStep('MANUAL', 'step_1'), name: 'First step' };
    const step2 = { ...newBuilderStep('MANUAL', 'step_2'), name: 'Second step' };
    const step3 = { ...newBuilderStep('MANUAL', 'step_3'), name: 'Third step' };

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [step1, step2, step3] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    // Select Second step
    const selectStep2Btn = screen.getByRole('button', { name: 'Step 2: Second step' });
    fireEvent.click(selectStep2Btn);
    expect(screen.getByRole('heading', { name: 'Step 2: Second step' })).toBeTruthy();

    // Move First step down (which swaps step 1 and step 2)
    const moveDownBtn = screen.getByRole('button', { name: 'Move First step down' });
    fireEvent.click(moveDownBtn);

    // The editor must STILL be editing Second step (now at Step 1 position)!
    expect(screen.getByRole('heading', { name: 'Step 1: Second step' })).toBeTruthy();
    const stepNameInput = screen.getByLabelText('Step name') as HTMLInputElement;
    expect(stepNameInput.value).toBe('Second step');
  });

  it('preserves active step selection when removing an earlier step', () => {
    const step1 = { ...newBuilderStep('MANUAL', 'step_1'), name: 'First step' };
    const step2 = { ...newBuilderStep('MANUAL', 'step_2'), name: 'Second step' };
    const step3 = { ...newBuilderStep('MANUAL', 'step_3'), name: 'Third step' };

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [step1, step2, step3] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    // Select Second step
    const selectStep2Btn = screen.getByRole('button', { name: 'Step 2: Second step' });
    fireEvent.click(selectStep2Btn);
    expect(screen.getByRole('heading', { name: 'Step 2: Second step' })).toBeTruthy();

    // Remove First step
    const removeStep1Btn = screen.getByRole('button', { name: 'Remove First step' });
    fireEvent.click(removeStep1Btn);

    // The editor must still be editing Second step (now at index 0 / Step 1)!
    expect(screen.getByRole('heading', { name: 'Step 1: Second step' })).toBeTruthy();
    const stepNameInput = screen.getByLabelText('Step name') as HTMLInputElement;
    expect(stepNameInput.value).toBe('Second step');
  });

  it('checks against flattened nested keys when adding a new step', () => {
    const parentStep = {
      ...newBuilderStep('MANUAL', 'step_1'),
      name: 'Parent step',
      precheck: {
        steps: [
          { ...newBuilderStep('SYSTEMD', 'step_2'), name: 'Nested check with step_2 key' },
        ],
      },
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [parentStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const addStepBtn = screen.getByRole('button', { name: 'Add Step' });
    fireEvent.click(addStepBtn);

    const saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps).toHaveLength(2);
    // Because step_2 is already used in nested prechecks, new step must get step_3!
    expect(saved.steps[1].key).toBe('step_3');
  });

  it('validates Kubernetes action and resource compatibility rules', () => {
    const invalidK8sStep = {
      ...newBuilderStep('KUBERNETES', 'k8s_restart'),
      name: 'Restart Job',
      config: {
        action: 'rollout-restart',
        namespace: 'default',
        resource: 'job',
        name: 'batch-worker',
      },
    };

    const result = validateStep(invalidK8sStep);
    expect(result.isValid).toBe(false);
    expect(result.errors.resource).toContain('does not support resource "job"');

    const validK8sStep = {
      ...newBuilderStep('KUBERNETES', 'k8s_restart_valid'),
      name: 'Restart Deployment',
      config: {
        action: 'rollout-restart',
        namespace: 'default',
        resource: 'deployment',
        name: 'batch-worker',
      },
    };
    const validResult = validateStep(validK8sStep);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors.resource).toBeUndefined();
  });
});


