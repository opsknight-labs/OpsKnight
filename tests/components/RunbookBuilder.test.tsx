import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RunbookBuilder from '@/components/runbooks/RunbookBuilder';
import { newBuilderStep } from '@/lib/runbooks/builder';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';
import { validateRunbook, validateStep } from '@/components/runbooks/builder/validation';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';

vi.mock('@/components/ui/DetailTabs', () => ({
  default: ({
    activeTab,
    onTabChange,
    tabs,
  }: {
    activeTab?: string;
    onTabChange?: (tab: string) => void;
    tabs: { id: string; label: string; content: ReactNode }[];
  }) => (
    <div>
      <div role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map(tab => (
        <div key={tab.id} data-tab-id={tab.id}>
          {tab.content}
        </div>
      ))}
    </div>
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

  it('loads, edits, saves and reloads a scale step using a replica template', () => {
    const templatedScaleStep: RunbookStepDefinition = {
      ...newBuilderStep('KUBERNETES', 'scale_step'),
      name: 'Scale Checkout Service',
      riskClass: 'IDEMPOTENT_WRITE',
      config: {
        action: 'scale',
        namespace: 'production',
        resource: 'deployment',
        name: 'checkout-api',
        replicas: '${{ inputs.target_replicas }}',
      },
    };

    const runbookInputs: RunbookInputInput[] = [
      {
        key: 'target_replicas',
        label: 'Target Replicas',
        type: 'NUMBER',
        description: '',
        required: true,
        sequence: 0,
      },
      {
        key: 'fallback_replicas',
        label: 'Fallback Replicas',
        type: 'NUMBER',
        description: '',
        required: false,
        sequence: 1,
      },
    ];

    // 1. Initial Load: template must be visibly displayed in input reference field
    const { container, unmount } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [templatedScaleStep] }}
        initialInputs={runbookInputs}
        action={async () => {}}
      />
    );

    const templateInput = screen.getByLabelText(
      'Desired replicas input reference'
    ) as HTMLInputElement;
    expect(templateInput.value).toBe('${{ inputs.target_replicas }}');

    // 2. Edit template value
    fireEvent.change(templateInput, {
      target: { value: '${{ inputs.fallback_replicas }}' },
    });

    // 3. Save: check that serialized hidden definition contains the edited template
    const savedDefinitionJson = (
      container.querySelector('input[name="definition"]') as HTMLInputElement
    ).value;
    const savedDefinition = parseRunbookDefinition(JSON.parse(savedDefinitionJson));
    expect(savedDefinition.steps[0].config.replicas).toBe('${{ inputs.fallback_replicas }}');

    unmount();

    // 4. Reload: verify that loading the saved definition renders the updated template visibly
    const { container: reloadedContainer } = render(
      <RunbookBuilder
        initialDefinition={savedDefinition}
        initialInputs={runbookInputs}
        action={async () => {}}
      />
    );

    const reloadedTemplateInput = screen.getByLabelText(
      'Desired replicas input reference'
    ) as HTMLInputElement;
    expect(reloadedTemplateInput.value).toBe('${{ inputs.fallback_replicas }}');

    // 5. Mode Switch: switch to Fixed count
    const fixedModeBtn = screen.getByRole('button', { name: 'Fixed count' });
    fireEvent.click(fixedModeBtn);

    const fixedNumberInput = screen.getByLabelText(
      'Desired replicas (Agent policy is authoritative)'
    ) as HTMLInputElement;
    fireEvent.change(fixedNumberInput, { target: { value: '4' } });

    const fixedSaved = parseRunbookDefinition(
      JSON.parse(
        (reloadedContainer.querySelector('input[name="definition"]') as HTMLInputElement).value
      )
    );
    expect(fixedSaved.steps[0].config.replicas).toBe(4);
  });

  it('rejects explicitly empty Kubernetes namespace locally to match server semantics', () => {
    // Explicit empty namespace must fail
    const stepEmptyNs = {
      ...newBuilderStep('KUBERNETES', 'k8s_empty_ns'),
      name: 'Get Pods',
      config: {
        action: 'get',
        namespace: '',
        resource: 'pods',
      },
    };
    const resultEmpty = validateStep(stepEmptyNs);
    expect(resultEmpty.isValid).toBe(false);
    expect(resultEmpty.errors.namespace).toBeTruthy();

    // Explicit whitespace namespace must fail
    const stepWhitespaceNs = {
      ...newBuilderStep('KUBERNETES', 'k8s_whitespace_ns'),
      name: 'Get Pods',
      config: {
        action: 'get',
        namespace: '   ',
        resource: 'pods',
      },
    };
    const resultWhitespace = validateStep(stepWhitespaceNs);
    expect(resultWhitespace.isValid).toBe(false);
    expect(resultWhitespace.errors.namespace).toBeTruthy();

    // Omitted namespace legitimately defaults to 'default' and succeeds
    const stepOmittedNs = {
      ...newBuilderStep('KUBERNETES', 'k8s_omitted_ns'),
      name: 'Get Pods',
      config: {
        action: 'get',
        resource: 'pods',
      },
    };
    const resultOmitted = validateStep(stepOmittedNs);
    expect(resultOmitted.isValid).toBe(true);
    expect(resultOmitted.errors.namespace).toBeUndefined();

    // Input template namespace succeeds
    const stepTemplateNs = {
      ...newBuilderStep('KUBERNETES', 'k8s_template_ns'),
      name: 'Get Pods',
      config: {
        action: 'get',
        namespace: '${{ inputs.target_namespace }}',
        resource: 'pods',
      },
    };
    const resultTemplate = validateStep(stepTemplateNs);
    expect(resultTemplate.isValid).toBe(true);
    expect(resultTemplate.errors.namespace).toBeUndefined();
  });

  it('enforces validation parity across all step action types', () => {
    // 1. HTTP: requires URL, rejects embedded credentials, supports input templates
    const invalidHttpCreds = {
      ...newBuilderStep('HTTP', 'http_creds'),
      name: 'Call API',
      config: { url: 'https://user:pass@api.internal/health' },
    };
    expect(validateStep(invalidHttpCreds).errors.url).toContain('credentials');

    const validHttpTemplate = {
      ...newBuilderStep('HTTP', 'http_tmpl'),
      name: 'Call API',
      config: { url: '${{ inputs.endpoint_url }}' },
    };
    expect(validateStep(validHttpTemplate).isValid).toBe(true);

    // 2. SYSTEMD: rejects leading hyphen, validates unit suffix
    const invalidSystemdHyphen = {
      ...newBuilderStep('SYSTEMD', 'sys_hyphen'),
      name: 'Unit Check',
      config: { unit: '-invalid.service' },
    };
    expect(validateStep(invalidSystemdHyphen).isValid).toBe(false);

    // 3. DOCKER: rejects leading hyphen, validates container name
    const invalidDockerHyphen = {
      ...newBuilderStep('DOCKER', 'docker_hyphen'),
      name: 'Container Check',
      config: { container: '-my-container' },
    };
    expect(validateStep(invalidDockerHyphen).isValid).toBe(false);

    // 4. LINUX_DIAGNOSTICS: validates TCP port range
    const invalidTcpPort = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'diag_tcp'),
      name: 'TCP Check',
      config: { diagnostic: 'tcp', host: '127.0.0.1', port: 70000 },
    };
    expect(validateStep(invalidTcpPort).errors.port).toBeTruthy();

    // 5. WAIT: validates duration bounds 1-3600
    const invalidWait = {
      ...newBuilderStep('WAIT', 'wait_step'),
      name: 'Pause',
      config: { durationSeconds: 5000 },
    };
    expect(validateStep(invalidWait).errors.durationSeconds).toBeTruthy();

    // 6. CONDITION: validates field and operator
    const invalidCond = {
      ...newBuilderStep('CONDITION', 'cond_step'),
      name: 'Check Status',
      config: { field: '', operator: 'EQUALS', value: 'UP' },
    };
    expect(validateStep(invalidCond).errors.field).toBeTruthy();
  });

  it('captures general input array errors in validateRunbook and provides clear destination', () => {
    // Construct 31 inputs to exceed MAX_RUNBOOK_INPUTS (30)
    const tooManyInputs: RunbookInputInput[] = Array.from({ length: 31 }, (_, i) => ({
      key: `param_${i + 1}`,
      label: `Param ${i + 1}`,
      type: 'STRING',
      description: '',
      required: false,
      sequence: i,
    }));

    const definition: RunbookDefinition = {
      steps: [newBuilderStep('WAIT', 'wait_step')],
    };

    const { generalInputErrors, errorCount } = validateRunbook(definition, tooManyInputs);
    expect(generalInputErrors.length).toBeGreaterThan(0);
    expect(generalInputErrors[0]).toContain('at most 30 element(s)');
    expect(errorCount).toBeGreaterThanOrEqual(1);

    // Render in builder to ensure the form-level parameter alert renders
    render(
      <RunbookBuilder
        initialDefinition={definition}
        initialInputs={tooManyInputs}
        action={async () => {}}
      />
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Parameter configuration issues:')).toBeTruthy();
    expect(screen.getByText(/at most 30 element/i)).toBeTruthy();
  });

  it('renders compact readiness summary and expandable panel with actionable navigation', () => {
    const invalidStep = {
      ...newBuilderStep('HTTP', 'bad_http'),
      name: 'Call Target',
      config: { url: '' }, // Missing URL
    };
    const invalidInputs: RunbookInputInput[] = [
      {
        key: 'INVALID KEY!', // Invalid key format
        label: 'My Input',
        type: 'STRING',
        description: '',
        required: false,
        sequence: 0,
      },
    ];

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [invalidStep] }}
        initialInputs={invalidInputs}
        action={async () => {}}
      />
    );

    // Initial compact readiness bar must show issues count
    const issuesBtn = screen.getByTitle('Toggle error details');
    expect(issuesBtn).toBeTruthy();
    expect(issuesBtn.textContent).toContain('issues');

    // Click details to expand the actionable panel
    const detailsBtn = screen.getByRole('button', { name: /Show summary details/i });
    fireEvent.click(detailsBtn);

    // Panel should now display the actionable issues list
    expect(screen.getByText(/Actionable Issues/i)).toBeTruthy();
    expect(screen.getByText(/"Call Target" \(url\)/i)).toBeTruthy();
    expect(screen.getByText(/Parameter #1 \(key\)/i)).toBeTruthy();
  });

  it('synchronizes visual builder edits to advanced JSON and reports conflicts when both are modified', () => {
    const initialStep = newBuilderStep('MANUAL', 'step_1');
    initialStep.name = 'Initial Name';
    const initialInput: RunbookInputInput = {
      key: 'param_1',
      label: 'Parameter 1',
      type: 'STRING',
      description: '',
      required: false,
      sequence: 0,
    };

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [initialStep] }}
        initialInputs={[initialInput]}
        action={async () => {}}
      />
    );

    // 1. Edit visual builder: step name
    const stepNameInput = screen.getByLabelText('Step name');
    fireEvent.change(stepNameInput, { target: { value: 'Updated Name In Builder' } });

    // Definition JSON textarea should automatically reflect the visual builder change
    const defJsonTextarea = screen.getByLabelText('Definition JSON') as HTMLTextAreaElement;
    expect(defJsonTextarea.value).toContain('Updated Name In Builder');

    // 2. Add an input in builder
    const addInputBtn = screen.getByRole('button', { name: 'Add input' });
    fireEvent.click(addInputBtn);

    const inputsJsonTextarea = screen.getByLabelText('Typed inputs JSON') as HTMLTextAreaElement;
    expect(inputsJsonTextarea.value).toContain('input_1');

    // 3. User edits JSON directly in Advanced tab -> unappliedJson becomes true
    fireEvent.change(defJsonTextarea, {
      target: {
        value: JSON.stringify(
          { steps: [{ ...initialStep, name: 'Conflict JSON Name' }] },
          null,
          2
        ),
      },
    });

    // Both visual builder and JSON have modifications -> conflict alert must appear!
    const conflictAlert = screen.getByText(
      'Conflict Warning: Visual Builder and JSON Editor Both Have Modifications'
    );
    expect(conflictAlert).toBeTruthy();

    // 4. Click "Refresh JSON from builder" to discard JSON edits and restore builder state
    const refreshBtn = screen.getByRole('button', { name: 'Refresh JSON from builder' });
    fireEvent.click(refreshBtn);

    expect(
      screen.queryByText('Conflict Warning: Visual Builder and JSON Editor Both Have Modifications')
    ).toBeNull();
    expect(defJsonTextarea.value).toContain('Updated Name In Builder');
  });

  it('applies edited advanced JSON to the visual builder and refreshes step identities', () => {
    const initialStep = newBuilderStep('MANUAL', 'step_1');
    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [initialStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const newDef: RunbookDefinition = {
      steps: [
        {
          ...newBuilderStep('HTTP', 'applied_http_step'),
          name: 'Applied From Advanced JSON',
          config: { method: 'GET', url: 'https://status.example.com' },
        },
      ],
    };
    const newInputs: RunbookInputInput[] = [
      {
        key: 'applied_input',
        label: 'Applied Input',
        type: 'STRING',
        description: '',
        required: true,
        sequence: 0,
      },
    ];

    const defJsonTextarea = screen.getByLabelText('Definition JSON');
    fireEvent.change(defJsonTextarea, { target: { value: JSON.stringify(newDef, null, 2) } });

    const inputsJsonTextarea = screen.getByLabelText('Typed inputs JSON');
    fireEvent.change(inputsJsonTextarea, { target: { value: JSON.stringify(newInputs, null, 2) } });

    const applyBtn = screen.getByRole('button', { name: 'Apply JSON to builder' });
    fireEvent.click(applyBtn);

    // Verify visual builder updated
    const saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].name).toBe('Applied From Advanced JSON');
    expect(saved.steps[0].key).toBe('applied_http_step');

    const savedInputs = JSON.parse(
      (container.querySelector('input[name="inputs"]') as HTMLInputElement).value
    );
    expect(savedInputs[0].key).toBe('applied_input');
  });

  it('deletes config.body when switching HTTP method to GET or HEAD and formats object bodies cleanly', () => {
    const postStep = {
      ...newBuilderStep('HTTP', 'http_step'),
      name: 'Post Data',
      riskClass: 'NON_IDEMPOTENT' as const,
      config: {
        method: 'POST',
        url: 'https://api.example.com/items',
        headers: { 'Content-Type': 'application/json' },
        body: { greeting: 'hello', count: 42 },
      },
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [postStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    // Formatted JSON should be rendered in textarea instead of [object Object]
    const bodyTextarea = screen.getByLabelText('Request body') as HTMLTextAreaElement;
    expect(bodyTextarea.value).toContain('"greeting": "hello"');
    expect(bodyTextarea.value).not.toContain('[object Object]');

    // Switch method to GET
    const methodSelect = screen.getByLabelText('HTTP Method');
    fireEvent.change(methodSelect, { target: { value: 'GET' } });

    // config.body must be deleted completely
    const saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].config.method).toBe('GET');
    expect(saved.steps[0].config.body).toBeUndefined();
  });

  it('normalizes condition operator values when switching between scalar, array, and unary operators', () => {
    const conditionStep = {
      ...newBuilderStep('CONDITION', 'cond_step'),
      name: 'Check Severity',
      config: {
        field: 'incident.priority',
        operator: 'IN',
        value: ['P1', 'P2'],
      },
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [conditionStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    const operatorSelect = screen.getByLabelText('Operator');

    // 1. Switch from IN (array) to EQUALS (scalar): should normalize to first element 'P1'
    fireEvent.change(operatorSelect, { target: { value: 'EQUALS' } });
    let saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].config.operator).toBe('EQUALS');
    expect(saved.steps[0].config.value).toBe('P1');

    // 2. Switch from EQUALS to EXISTS (unary): should normalize value to null
    fireEvent.change(operatorSelect, { target: { value: 'EXISTS' } });
    saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].config.operator).toBe('EXISTS');
    expect(saved.steps[0].config.value).toBeNull();

    // 3. Switch back to IN: should normalize value to array
    fireEvent.change(operatorSelect, { target: { value: 'IN' } });
    saved = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(saved.steps[0].config.operator).toBe('IN');
    expect(Array.isArray(saved.steps[0].config.value)).toBe(true);
  });

  it('displays accurate bash execution copy, allowlist guidance, and environment variable helpers', () => {
    const bashStep = {
      ...newBuilderStep('BASH', 'bash_step'),
      name: 'Run Cleanup',
      config: { command: 'echo "hello"' },
    };
    const inputs: RunbookInputInput[] = [
      {
        key: 'target_dir',
        label: 'Target Directory',
        type: 'STRING',
        description: '',
        required: false,
        sequence: 0,
      },
    ];

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [bashStep] }}
        initialInputs={inputs}
        action={async () => {}}
      />
    );

    // Verifies the accurate execution copy
    expect(screen.getAllByText(/bash --noprofile --norc -c/i).length).toBeGreaterThan(0);

    // Verifies allowlist guidance and env helper button
    expect(screen.getAllByText(/Allowlist matching/i).length).toBeGreaterThan(0);
    const envHelperBtn = screen.getByRole('button', { name: '"$OPSKNIGHT_INPUT_TARGET_DIR"' });
    expect(envHelperBtn).toBeTruthy();

    // Clicking env helper appends it to the command
    const commandTextarea = screen.getByLabelText('Exact allowlisted command') as HTMLTextAreaElement;
    fireEvent.click(envHelperBtn);
    expect(commandTextarea.value).toContain('"$OPSKNIGHT_INPUT_TARGET_DIR"');
  });

  it('generates next unused input key after deletions and refactors input references on key change', () => {
    const initialInputs: RunbookInputInput[] = [
      {
        key: 'input_1',
        label: 'First',
        type: 'STRING',
        description: '',
        required: false,
        sequence: 0,
      },
      {
        key: 'input_2',
        label: 'Second',
        type: 'STRING',
        description: '',
        required: false,
        sequence: 1,
      },
    ];
    const stepWithRef = {
      ...newBuilderStep('HTTP', 'api_call'),
      name: 'Call API',
      config: {
        method: 'GET',
        url: 'https://api.internal/${{ inputs.input_2 }}',
      },
    };

    const { container } = render(
      <RunbookBuilder
        initialDefinition={{ steps: [stepWithRef] }}
        initialInputs={initialInputs}
        action={async () => {}}
      />
    );

    // 1. Delete parameter 1 (input_1)
    const removeBtn = screen.getByRole('button', { name: 'Remove input 1' });
    fireEvent.click(removeBtn);

    // 2. Add a new input: should pick input_1 because it's now unused!
    const addInputBtn = screen.getByRole('button', { name: 'Add input' });
    fireEvent.click(addInputBtn);

    const savedInputs = JSON.parse(
      (container.querySelector('input[name="inputs"]') as HTMLInputElement).value
    );
    expect(savedInputs.some((inp: RunbookInputInput) => inp.key === 'input_1')).toBe(true);

    // 3. Rename input_2 to target_cluster: should automatically refactor step reference
    const input2KeyInput = screen.getByLabelText('Input 1 key'); // input_2 is now at position 0
    fireEvent.change(input2KeyInput, { target: { value: 'target_cluster' } });

    const savedDef = parseRunbookDefinition(
      JSON.parse((container.querySelector('input[name="definition"]') as HTMLInputElement).value)
    );
    expect(savedDef.steps[0].config.url).toBe('https://api.internal/${{ inputs.target_cluster }}');
  });

  it('surfaces nested check errors with issue badges and detects undeclared input references', () => {
    const stepWithFailingNested = {
      ...newBuilderStep('MANUAL', 'parent_step'),
      name: 'Parent with precheck',
      precheck: {
        steps: [
          {
            ...newBuilderStep('SYSTEMD', 'nested_sys'),
            name: 'Nested Service Check',
            config: { action: 'status', unit: '' }, // empty unit is an error
          },
        ],
      },
    };

    render(
      <RunbookBuilder
        initialDefinition={{ steps: [stepWithFailingNested] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    // Nested check should display an issue count badge
    expect(screen.getByText('1 issue')).toBeTruthy();

    // Undeclared input references:
    const stepWithGhostInput = {
      ...newBuilderStep('BASH', 'ghost_step'),
      name: 'Ghost Step',
      config: { command: 'cat ${{ inputs.ghost_param }}' },
    };
    const valResult = validateRunbook({ steps: [stepWithGhostInput] }, []);
    expect(valResult.generalInputErrors.some(err => err.includes('ghost_param'))).toBe(true);
  });

  it('enforces client-server validation parity for status codes, port bounds, and byte sizes', () => {
    // 1. Linux Diagnostics HTTP: invalid status code 700
    const invalidStatusStep = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'diag_http'),
      config: { diagnostic: 'http', url: 'https://example.com', expectedStatus: 700 },
    };
    expect(validateStep(invalidStatusStep).errors.expectedStatus).toBeTruthy();

    // 2. Linux Diagnostics HTTP: URL credentials
    const invalidUrlCreds = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'diag_http_creds'),
      config: { diagnostic: 'http', url: 'https://user:pass@example.com' },
    };
    expect(validateStep(invalidUrlCreds).errors.url).toContain('credentials');

    // 3. Linux Diagnostics TCP: invalid port 0
    const invalidPort0 = {
      ...newBuilderStep('LINUX_DIAGNOSTICS', 'diag_port0'),
      config: { diagnostic: 'tcp', host: '127.0.0.1', port: 0 },
    };
    expect(validateStep(invalidPort0).errors.port).toBeTruthy();

    // 4. Bash command size limit 8 KiB
    const oversizedBash = {
      ...newBuilderStep('BASH', 'oversized_bash'),
      config: { command: 'a'.repeat(9 * 1024) },
    };
    expect(validateStep(oversizedBash).errors.command).toContain('8 KiB');

    // 5. HTTP body size limit 64 KiB
    const oversizedHttpBody = {
      ...newBuilderStep('HTTP', 'oversized_http'),
      config: { url: 'https://example.com', method: 'POST', body: 'x'.repeat(65 * 1024) },
    };
    expect(validateStep(oversizedHttpBody).errors.body).toContain('64 KiB');

    // 6. Condition scalar operator with array value
    const invalidConditionShape = {
      ...newBuilderStep('CONDITION', 'bad_cond'),
      config: { field: 'incident.priority', operator: 'EQUALS', value: ['P1', 'P2'] },
    };
    expect(validateStep(invalidConditionShape).errors.value).toContain('array');
  });

  it('renders agent prerequisites banner for agent-backed step types', () => {
    const bashStep = newBuilderStep('BASH', 'step_bash');
    render(
      <RunbookBuilder
        initialDefinition={{ steps: [bashStep] }}
        initialInputs={[]}
        action={async () => {}}
      />
    );

    expect(screen.getByText(/Requires Agent with BASH capability/i)).toBeTruthy();
  });
});


