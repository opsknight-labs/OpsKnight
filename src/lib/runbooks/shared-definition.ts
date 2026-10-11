/**
 * OpsKnight Runbooks — Definition parsing, validation, and integrity utilities.
 *
 * This module handles:
 * - Parsing and validating runbook definition JSON
 * - Computing deterministic checksums for version immutability
 * - Extracting step metadata for execution planning
 * - Resolving input references (including secret:// references)
 */

import {
  workflowConditionSchema,
  conditionValueType,
  validateConditionComparison,
} from './conditions';
import { stepRequiresApproval } from './safety';
import { isSecretReferenceValue } from './input-values';
import { runbookDefinitionSchema } from './schemas';
import {
  RunbookDefinitionError,
  RunbookStepKeyDuplicateError,
  RunbookInputKeyDuplicateError,
} from './errors';
import {
  MAX_RUNBOOK_STEPS,
  type RunbookDefinition,
  type RunbookStepDefinition,
  type RunbookRiskClass,
  type RunbookStepType,
} from './types';

// ---------------------------------------------------------------------------
// Parse and validate
// ---------------------------------------------------------------------------

/**
 * Parses and validates a runbook definition from raw JSON.
 * Throws `RunbookDefinitionError` on validation failure.
 */
export function parseRunbookDefinition(
  raw: unknown,
  inputs?: ReadonlyArray<{ key: string; type?: string }>
): RunbookDefinition {
  const result = runbookDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
    throw new RunbookDefinitionError(`Invalid runbook definition: ${issues.join('; ')}`, {
      issues: result.error.issues,
    });
  }
  const definition = result.data as RunbookDefinition;
  validateDefinitionStructure(definition);
  if (inputs) {
    const declared = new Set(inputs.map(input => input.key));
    const inputTypeMap = new Map(inputs.map(input => [input.key, input.type]));
    for (const step of flattenSteps(definition)) {
      if (step.type === 'CONDITION') {
        const issue = validateConditionComparison(
          step.config,
          conditionValueType(
            String(step.config.field),
            inputs.map(input => ({ ...input, type: input.type ?? 'STRING' }))
          ),
          inputs
        );
        if (issue) throw new RunbookDefinitionError(`Step "${step.key}": ${issue}`);
        const { field } = workflowConditionSchema.parse(step.config);
        const condMatch = field.match(/^inputs?\.([a-z0-9_]+)$/);
        if (condMatch && !declared.has(condMatch[1])) {
          throw new RunbookDefinitionError(
            `Step "${step.key}" references undeclared CONDITION input "${field}".`
          );
        }
      }
      if (step.type === 'KUBERNETES') {
        const action = configuredString(step, 'action', 'get');
        if (action === 'scale') {
          const rawReplicas = step.config.replicas;
          if (typeof rawReplicas === 'string') {
            const match = rawReplicas.trim().match(INPUT_TEMPLATE);
            if (match) {
              const inputKey = match[1];
              if (!declared.has(inputKey)) {
                throw new RunbookDefinitionError(
                  `Step "${step.key}" references undeclared replica input "${inputKey}".`
                );
              }
              const inputType = inputTypeMap.get(inputKey);
              if (inputType && inputType !== 'NUMBER') {
                throw new RunbookDefinitionError(
                  `Step "${step.key}" references input "${inputKey}" of type ${inputType} for Kubernetes replicas; must be NUMBER.`
                );
              }
            }
          }
        }
      }
      const referenced = referencedStepInputKeys(step, undefined, false);
      for (const refKey of referenced) {
        if (step.type === 'HTTP' && inputTypeMap.get(refKey) === 'SECRET_REF')
          throw new RunbookDefinitionError(
            `Step "${step.key}" HTTP steps cannot consume secret references; use a scoped execution Agent.`
          );
        if (!declared.has(refKey)) {
          throw new RunbookDefinitionError(
            `Step "${step.key}" references undeclared input "${refKey}".`
          );
        }
      }
    }
  }
  return definition;
}

function validateDefinitionStructure(definition: RunbookDefinition): void {
  const serialized = JSON.stringify(definition);
  if (new TextEncoder().encode(serialized).length > 256 * 1024) {
    throw new RunbookDefinitionError('Runbook definition exceeds maximum allowed size of 256 KiB.');
  }
  const stack = definition.steps.map(step => ({ step, depth: 1 }));
  const keys = new Set<string>();
  let count = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    count++;
    if (count > MAX_RUNBOOK_STEPS) {
      throw new RunbookDefinitionError(
        `Runbook contains more than ${MAX_RUNBOOK_STEPS} total steps, including prechecks and verification.`
      );
    }
    if (current.depth > 3) {
      throw new RunbookDefinitionError('Runbook steps may not be nested more than three levels.');
    }
    if (keys.has(current.step.key)) throw new RunbookStepKeyDuplicateError(current.step.key);
    keys.add(current.step.key);
    validateStepSemantics(current.step);
    if ((current.step.verification?.delaySeconds ?? 0) > 0) {
      throw new RunbookDefinitionError(
        `Step "${current.step.key}" uses verification.delaySeconds, which is not supported. Add an explicit WAIT verification step instead.`
      );
    }
    for (const nested of current.step.precheck?.steps ?? []) {
      stack.push({ step: nested, depth: current.depth + 1 });
    }
    for (const nested of current.step.verification?.steps ?? []) {
      stack.push({ step: nested, depth: current.depth + 1 });
    }
  }
}

const RISK_RANK = new Map<RunbookRiskClass, number>([
  ['READ_ONLY', 0],
  ['IDEMPOTENT_WRITE', 1],
  ['NON_IDEMPOTENT', 2],
]);

const INPUT_TEMPLATE = /^\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}$/;
const SYSTEMD_UNIT =
  /^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.(?:service|socket|timer|target|mount|path|slice|scope|device|automount|swap)$/;
const DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const KUBERNETES_NAME = /^(?:[a-z0-9]|[a-z0-9][a-z0-9.-]*[a-z0-9])$/;

function configuredString(step: RunbookStepDefinition, key: string, fallback = ''): string {
  const value = Object.entries(step.config).find(([name]) => name === key)?.[1];
  return typeof value === 'string' ? value : fallback;
}

/** Minimum risk is derived from executable semantics, never author trust. */
export function minimumRiskForStep(step: RunbookStepDefinition): RunbookRiskClass {
  switch (step.type) {
    case 'BASH':
      return 'NON_IDEMPOTENT';
    case 'HTTP':
      switch (configuredString(step, 'method', 'GET').toUpperCase()) {
        case 'GET':
        case 'HEAD':
          return 'READ_ONLY';
        case 'PUT':
        case 'DELETE':
          return 'IDEMPOTENT_WRITE';
        default:
          return 'NON_IDEMPOTENT';
      }
    case 'SYSTEMD': {
      const action = configuredString(step, 'action', 'status');
      return ['status', 'logs'].includes(action)
        ? 'READ_ONLY'
        : action === 'restart'
          ? 'NON_IDEMPOTENT'
          : 'IDEMPOTENT_WRITE';
    }
    case 'DOCKER': {
      const action = configuredString(step, 'action', 'inspect');
      return ['inspect', 'logs', 'health'].includes(action)
        ? 'READ_ONLY'
        : action === 'restart'
          ? 'NON_IDEMPOTENT'
          : 'IDEMPOTENT_WRITE';
    }
    case 'KUBERNETES':
      return configuredString(step, 'action', 'get') === 'scale'
        ? 'IDEMPOTENT_WRITE'
        : configuredString(step, 'action', 'get') === 'rollout-restart'
          ? 'NON_IDEMPOTENT'
          : 'READ_ONLY';
    default:
      return 'READ_ONLY';
  }
}

function validateTarget(
  value: string,
  pattern: RegExp,
  label: string,
  stepKey: string,
  allowInputTemplate: boolean
): void {
  if (allowInputTemplate && INPUT_TEMPLATE.test(value)) return;
  if (!value || value.startsWith('-') || !pattern.test(value)) {
    throw new RunbookDefinitionError(`Step "${stepKey}" has an invalid ${label}.`);
  }
}

function validateStepSemantics(step: RunbookStepDefinition, allowInputTemplates = true): void {
  const serializedConfig = JSON.stringify(step.config);
  for (const match of serializedConfig.matchAll(/\$\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (/[A-Z]/.test(match[1])) {
      throw new RunbookDefinitionError(
        `Step "${step.key}" contains uppercase placeholder "${match[0]}". Input placeholder keys must be lowercase.`
      );
    }
  }
  if (step.name) {
    for (const match of step.name.matchAll(/\$\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g)) {
      if (/[A-Z]/.test(match[1])) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" contains uppercase placeholder "${match[0]}". Input placeholder keys must be lowercase.`
        );
      }
    }
  }
  if (step.description) {
    for (const match of step.description.matchAll(/\$\{\{\s*inputs\.([A-Za-z0-9_]+)\s*\}\}/g)) {
      if (/[A-Z]/.test(match[1])) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" contains uppercase placeholder "${match[0]}". Input placeholder keys must be lowercase.`
        );
      }
    }
  }
  const checkTemplates = (value: unknown, depth = 0): void => {
    if (depth > 12)
      throw new RunbookDefinitionError(`Step "${step.key}" configuration is nested too deeply.`);
    if (typeof value === 'string') {
      const remainder = value.replace(/\$\{\{\s*inputs\.[a-z0-9_]+\s*\}\}/g, '');
      if (remainder.includes('${{'))
        throw new RunbookDefinitionError(
          `Step "${step.key}" contains an unsupported or malformed input template.`
        );
    } else if (Array.isArray(value)) value.forEach(nested => checkTemplates(nested, depth + 1));
    else if (value && typeof value === 'object')
      Object.values(value).forEach(nested => checkTemplates(nested, depth + 1));
  };
  checkTemplates(step.config);
  checkTemplates(step.name);
  checkTemplates(step.description);
  if (
    step.type === 'WAIT' &&
    (!Number.isInteger(step.config.durationSeconds) ||
      Number(step.config.durationSeconds) < 0 ||
      Number(step.config.durationSeconds) > 86400)
  ) {
    throw new RunbookDefinitionError(
      `Step "${step.key}" wait duration must be an integer between 0 and 86400 seconds.`
    );
  }
  const maxConfigBytes = step.type === 'HTTP' ? 96 * 1024 : 32 * 1024;
  if (new TextEncoder().encode(serializedConfig).length > maxConfigBytes) {
    throw new RunbookDefinitionError(
      `Step "${step.key}" config exceeds maximum allowed size of ${step.type === 'HTTP' ? '96' : '32'} KiB.`
    );
  }
  if (step.type === 'CONDITION' && !workflowConditionSchema.safeParse(step.config).success) {
    throw new RunbookDefinitionError(
      `Step "${step.key}" has an unsupported CONDITION field or operator.`
    );
  }
  const minimumRisk = minimumRiskForStep(step);
  if (
    (step.type === 'SYSTEMD' || step.type === 'LINUX_DIAGNOSTICS') &&
    step.config.lines !== undefined &&
    (!Number.isInteger(step.config.lines) ||
      Number(step.config.lines) < 1 ||
      Number(step.config.lines) > 500)
  )
    throw new RunbookDefinitionError('Journal lines must be an integer between 1 and 500.');
  if (RISK_RANK.get(step.riskClass)! < RISK_RANK.get(minimumRisk)!) {
    throw new RunbookDefinitionError(
      `Step "${step.key}" declares ${step.riskClass}, but ${step.type} ${configuredString(step, 'action', configuredString(step, 'method')) || 'execution'} requires at least ${minimumRisk}.`
    );
  }
  if (step.type === 'SYSTEMD') {
    const action = configuredString(step, 'action', 'status');
    if (!['status', 'start', 'stop', 'restart', 'logs'].includes(action)) {
      throw new RunbookDefinitionError(`Step "${step.key}" has an unsupported systemd action.`);
    }
    validateTarget(
      configuredString(step, 'unit'),
      SYSTEMD_UNIT,
      'systemd unit',
      step.key,
      allowInputTemplates
    );
  }
  if (step.type === 'DOCKER') {
    const action = configuredString(step, 'action', 'inspect');
    if (
      !(allowInputTemplates && INPUT_TEMPLATE.test(configuredString(step, 'runtime'))) &&
      !['docker', 'podman'].includes(configuredString(step, 'runtime', 'docker'))
    )
      throw new RunbookDefinitionError('Unsupported container runtime.');
    if (!['inspect', 'logs', 'health', 'start', 'stop', 'restart'].includes(action)) {
      throw new RunbookDefinitionError(`Step "${step.key}" has an unsupported Docker action.`);
    }
    validateTarget(
      configuredString(step, 'container'),
      DOCKER_NAME,
      'Docker container',
      step.key,
      allowInputTemplates
    );
  }
  if (step.type === 'KUBERNETES') {
    const action = configuredString(step, 'action', 'get');
    if (
      !['get', 'describe', 'logs', 'events', 'rollout-status', 'rollout-restart', 'scale'].includes(
        action
      )
    ) {
      throw new RunbookDefinitionError(`Step "${step.key}" has an unsupported Kubernetes action.`);
    }
    validateTarget(
      configuredString(step, 'namespace', 'default'),
      KUBERNETES_NAME,
      'Kubernetes namespace',
      step.key,
      allowInputTemplates
    );
    const resource = configuredString(step, 'resource', 'pods').toLowerCase();
    validateTarget(resource, KUBERNETES_NAME, 'Kubernetes resource', step.key, allowInputTemplates);
    const name = configuredString(step, 'name');
    if (name)
      validateTarget(
        name,
        KUBERNETES_NAME,
        'Kubernetes resource name',
        step.key,
        allowInputTemplates
      );

    if (action === 'logs') {
      const allowedLogResources = [
        'pod',
        'pods',
        'deployment',
        'deployments',
        'daemonset',
        'daemonsets',
        'statefulset',
        'statefulsets',
      ];
      if (
        !(allowInputTemplates && INPUT_TEMPLATE.test(resource)) &&
        !allowedLogResources.includes(resource)
      ) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" Kubernetes logs action does not support resource "${resource}". Supported resources are Pod, Deployment, DaemonSet, and StatefulSet.`
        );
      }
      if (!name) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" requires a Kubernetes resource name for logs.`
        );
      }
    } else if (['rollout-restart', 'rollout-status'].includes(action)) {
      const allowedRolloutResources = [
        'deployment',
        'deployments',
        'daemonset',
        'daemonsets',
        'statefulset',
        'statefulsets',
      ];
      if (
        !(allowInputTemplates && INPUT_TEMPLATE.test(resource)) &&
        !allowedRolloutResources.includes(resource)
      ) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" Kubernetes ${action} does not support resource "${resource}". Supported resources are Deployment, DaemonSet, and StatefulSet.`
        );
      }
      if (!name) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" requires a Kubernetes resource name for ${action}.`
        );
      }
    } else if (action === 'scale') {
      const allowedScaleResources = [
        'deployment',
        'deployments',
        'statefulset',
        'statefulsets',
        'replicaset',
        'replicasets',
        'replicationcontroller',
        'replicationcontrollers',
      ];
      if (
        !(allowInputTemplates && INPUT_TEMPLATE.test(resource)) &&
        !allowedScaleResources.includes(resource)
      ) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" Kubernetes scale action does not support resource "${resource}". Supported resources are Deployment, StatefulSet, ReplicaSet, and ReplicationController.`
        );
      }
      if (!name) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" requires a Kubernetes resource name for scale.`
        );
      }
      if (
        !(allowInputTemplates && INPUT_TEMPLATE.test(String(step.config.replicas))) &&
        (!Number.isInteger(step.config.replicas) ||
          Number(step.config.replicas) < 0 ||
          Number(step.config.replicas) > 10000)
      ) {
        throw new RunbookDefinitionError('Kubernetes replicas must be an integer from 0 to 10000.');
      }
    }
  }
  if (step.type === 'LINUX_DIAGNOSTICS') {
    const diagnostic = configuredString(step, 'diagnostic', 'summary');
    if (
      ![
        'summary',
        'disk',
        'memory',
        'processes',
        'network',
        'dns',
        'tcp',
        'http',
        'journal',
        'listeners',
        'process',
        'filesystem',
      ].includes(diagnostic)
    )
      throw new RunbookDefinitionError('Unsupported Linux diagnostic.');
    if (diagnostic === 'process' && !configuredString(step, 'pattern'))
      throw new RunbookDefinitionError(`Step "${step.key}" requires a process pattern.`);
    if (diagnostic === 'filesystem' && !configuredString(step, 'path'))
      throw new RunbookDefinitionError(`Step "${step.key}" requires a filesystem path.`);
    if (diagnostic === 'journal')
      validateTarget(
        configuredString(step, 'unit'),
        SYSTEMD_UNIT,
        'systemd unit',
        step.key,
        allowInputTemplates
      );
    if (
      ['dns', 'tcp'].includes(diagnostic) &&
      !configuredString(step, diagnostic === 'dns' ? 'hostname' : 'host')
    )
      throw new RunbookDefinitionError('Network diagnostic requires a host.');
    if (
      diagnostic === 'tcp' &&
      (!Number.isInteger(step.config.port) ||
        Number(step.config.port) < 1 ||
        Number(step.config.port) > 65535)
    )
      throw new RunbookDefinitionError('Invalid TCP diagnostic port.');
    if (diagnostic === 'http' && !configuredString(step, 'url'))
      throw new RunbookDefinitionError('HTTP diagnostic requires a URL.');
    if (diagnostic === 'http') {
      const value = configuredString(step, 'url');
      if (!(allowInputTemplates && INPUT_TEMPLATE.test(value))) {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          throw new RunbookDefinitionError('HTTP diagnostic requires a valid URL.');
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new RunbookDefinitionError(
            'HTTP diagnostic URL must use HTTP(S) without credentials.'
          );
      }
      if (
        step.config.expectedStatus !== undefined &&
        (!Number.isInteger(step.config.expectedStatus) ||
          Number(step.config.expectedStatus) < 100 ||
          Number(step.config.expectedStatus) > 599)
      )
        throw new RunbookDefinitionError('Expected HTTP status must be between 100 and 599.');
    }
  }
  if (step.type === 'BASH') {
    const command = configuredString(step, 'command');
    if (!command) {
      throw new RunbookDefinitionError(`Step "${step.key}" requires a Bash command.`);
    }
    if (new TextEncoder().encode(command).length > 8192) {
      throw new RunbookDefinitionError(
        `Step "${step.key}" Bash command exceeds maximum allowed size of 8 KiB.`
      );
    }
  }
  if (step.type === 'HTTP') {
    const method = configuredString(step, 'method', 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new RunbookDefinitionError(`Step "${step.key}" has an unsupported HTTP method.`);
    }
    if (!configuredString(step, 'url')) {
      throw new RunbookDefinitionError(`Step "${step.key}" requires an HTTP URL.`);
    }
    const rawUrl = configuredString(step, 'url');
    const exampleUrl = allowInputTemplates
      ? rawUrl.replace(/\$\{\{\s*inputs\.[a-z0-9_]+\s*\}\}/g, 'input')
      : rawUrl;
    if (!(allowInputTemplates && INPUT_TEMPLATE.test(rawUrl))) {
      let url: URL;
      try {
        url = new URL(exampleUrl);
      } catch {
        throw new RunbookDefinitionError(`Step "${step.key}" requires a valid HTTP URL.`);
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new RunbookDefinitionError(
          `Step "${step.key}" URL must use HTTP(S) without credentials.`
        );
    }
    if (
      step.config.expectedStatus !== undefined &&
      (!Number.isInteger(step.config.expectedStatus) ||
        Number(step.config.expectedStatus) < 100 ||
        Number(step.config.expectedStatus) > 599)
    )
      throw new RunbookDefinitionError(
        `Step "${step.key}" expected HTTP status must be between 100 and 599.`
      );
    if (['GET', 'HEAD'].includes(method) && step.config.body !== undefined)
      throw new RunbookDefinitionError(
        `Step "${step.key}" ${method} does not support a request body.`
      );
    if (step.config.headers !== undefined) {
      if (
        typeof step.config.headers !== 'object' ||
        step.config.headers === null ||
        Array.isArray(step.config.headers)
      ) {
        throw new RunbookDefinitionError(`Step "${step.key}" HTTP headers must be an object.`);
      }
      const headers = step.config.headers as Record<string, unknown>;
      if (Object.values(headers).some(value => typeof value !== 'string'))
        throw new RunbookDefinitionError(`Step "${step.key}" HTTP header values must be strings.`);
      if (Object.keys(headers).length > 64) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" HTTP headers exceed maximum allowed count of 64 entries.`
        );
      }
      if (new TextEncoder().encode(JSON.stringify(headers)).length > 16 * 1024) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" HTTP headers exceed maximum allowed size of 16 KiB.`
        );
      }
    }
    if (step.config.body !== undefined) {
      const bodyStr =
        typeof step.config.body === 'string' ? step.config.body : JSON.stringify(step.config.body);
      if (new TextEncoder().encode(bodyStr).length > 64 * 1024) {
        throw new RunbookDefinitionError(
          `Step "${step.key}" HTTP body exceeds maximum allowed size of 64 KiB.`
        );
      }
    }
  }
}

/** Re-applies executable and target validation after typed input resolution. */
export function validateResolvedStepConfig(
  step: Pick<RunbookStepDefinition, 'key' | 'name' | 'type' | 'riskClass' | 'config'>,
  config: Record<string, unknown>
): void {
  validateStepSemantics({ ...step, config } as RunbookStepDefinition, false);
}

/**
 * Validates that all step keys within a definition are unique.
 */
export function validateStepKeyUniqueness(definition: RunbookDefinition): void {
  const keys = new Set<string>();
  const stack: RunbookStepDefinition[] = [...definition.steps];

  while (stack.length > 0) {
    const step = stack.pop()!;
    if (keys.has(step.key)) {
      throw new RunbookStepKeyDuplicateError(step.key);
    }
    keys.add(step.key);

    // Check nested verification and precheck steps
    if (step.verification?.steps) {
      stack.push(...step.verification.steps);
    }
    if (step.precheck?.steps) {
      stack.push(...step.precheck.steps);
    }
  }
}

/**
 * Validates that all input keys within a set of inputs are unique.
 */
export function validateInputKeyUniqueness(inputs: Array<{ key: string }>): void {
  const keys = new Set<string>();
  for (const input of inputs) {
    if (keys.has(input.key)) {
      throw new RunbookInputKeyDuplicateError(input.key);
    }
    keys.add(input.key);
  }
}

// ---------------------------------------------------------------------------
// Step metadata extraction
// ---------------------------------------------------------------------------

/**
 * Flattens all steps in a definition into a sequenced list,
 * including nested verification and precheck steps.
 */
export function flattenSteps(definition: RunbookDefinition): RunbookStepDefinition[] {
  const result: RunbookStepDefinition[] = [];
  const append = (step: RunbookStepDefinition) => {
    for (const precheck of step.precheck?.steps ?? []) append(precheck);
    result.push(step);
    for (const verification of step.verification?.steps ?? []) append(verification);
  };
  for (const step of definition.steps) append(step);
  return result;
}

/**
 * Extracts all unique step keys from a definition.
 */
export function extractStepKeys(definition: RunbookDefinition): string[] {
  return flattenSteps(definition).map(s => s.key);
}

/**
 * Returns the maximum risk class across all steps in a definition.
 * Useful for determining overall runbook risk level.
 */
export function getMaxRiskClass(definition: RunbookDefinition): RunbookRiskClass {
  let maxRisk: RunbookRiskClass = 'READ_ONLY';

  for (const step of flattenSteps(definition)) {
    if (RISK_RANK.get(step.riskClass)! > RISK_RANK.get(maxRisk)!) {
      maxRisk = step.riskClass;
    }
  }

  return maxRisk;
}

/**
 * Returns true if any step in the definition requires an agent.
 */
export function requiresAnyAgent(definition: RunbookDefinition): boolean {
  const localTypes: ReadonlySet<RunbookStepType> = new Set([
    'MANUAL',
    'APPROVAL',
    'CONDITION',
    'WAIT',
    'HTTP',
  ]);

  return flattenSteps(definition).some(step => !localTypes.has(step.type));
}

/**
 * Returns true if any step in the definition requires approval.
 */
export function requiresAnyApproval(definition: RunbookDefinition): boolean {
  return flattenSteps(definition).some(stepRequiresApproval);
}

// ---------------------------------------------------------------------------
// Input value resolution
// ---------------------------------------------------------------------------

const SECRET_REF_PREFIX = 'secret://';
const INPUT_TEMPLATE_GLOBAL = /\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}/g;

export function referencedStepInputKeys(
  value: unknown,
  explicitType?: string,
  includeNested = true
): Set<string> {
  const keys = new Set<string>();
  if (!value) return keys;

  const isStep =
    typeof value === 'object' && value !== null && 'type' in value && 'config' in value;
  let stepType =
    explicitType ?? (isStep ? String((value as Record<string, unknown>).type) : undefined);
  const config = isStep ? (value as Record<string, unknown>).config : value;

  if (isStep) {
    const stepObj = value as RunbookStepDefinition;
    if (typeof stepObj.name === 'string') {
      for (const match of stepObj.name.matchAll(INPUT_TEMPLATE_GLOBAL)) {
        keys.add(match[1].toLowerCase());
      }
    }
    if (typeof stepObj.description === 'string') {
      for (const match of stepObj.description.matchAll(INPUT_TEMPLATE_GLOBAL)) {
        keys.add(match[1].toLowerCase());
      }
    }
    if (includeNested && stepObj.precheck?.steps) {
      for (const pre of stepObj.precheck.steps) {
        for (const k of referencedStepInputKeys(pre)) keys.add(k);
      }
    }
    if (includeNested && stepObj.verification?.steps) {
      for (const ver of stepObj.verification.steps) {
        for (const k of referencedStepInputKeys(ver)) keys.add(k);
      }
    }
  }

  if (!stepType && config && typeof config === 'object') {
    if ('command' in config && typeof (config as Record<string, unknown>).command === 'string') {
      stepType = 'BASH';
    } else if ('field' in config && 'operator' in config) {
      stepType = 'CONDITION';
    }
  }

  if (stepType === 'CONDITION') {
    if (config && typeof config === 'object') {
      const field = (config as Record<string, unknown>).field;
      if (typeof field === 'string') {
        const condMatch = field.match(/^inputs?\.([a-z0-9_]+)$/);
        if (condMatch && condMatch[1]) keys.add(condMatch[1].toLowerCase());
      }
    }
  } else if (stepType === 'BASH') {
    if (config && typeof config === 'object') {
      const command = (config as Record<string, unknown>).command;
      if (typeof command === 'string') {
        for (const match of command.matchAll(INPUT_TEMPLATE_GLOBAL)) {
          keys.add(match[1].toLowerCase());
        }
        for (const match of command.matchAll(/\bOPSKNIGHT_INPUT_([A-Z0-9_]+)\b/g)) {
          keys.add(match[1].toLowerCase());
        }
      }
    }
  }
  {
    const visit = (entry: unknown) => {
      if (typeof entry === 'string') {
        for (const match of entry.matchAll(INPUT_TEMPLATE_GLOBAL)) {
          keys.add(match[1].toLowerCase());
        }
      } else if (Array.isArray(entry)) {
        entry.forEach(visit);
      } else if (entry && typeof entry === 'object') {
        Object.values(entry).forEach(visit);
      }
    };
    visit(config);
  }

  return keys;
}

/**
 * Checks if a value is a secret reference (e.g., "secret://prod-db-password").
 */
export function isSecretReference(value: unknown): value is string {
  return isSecretReferenceValue(value);
}

/**
 * Extracts the secret name from a secret reference string.
 */
export function extractSecretName(ref: string): string {
  if (!ref.startsWith(SECRET_REF_PREFIX)) {
    throw new RunbookDefinitionError(`Invalid secret reference: "${ref}"`);
  }
  return ref.slice(SECRET_REF_PREFIX.length);
}

/**
 * Resolves all secret references within input values, returning the set
 * of secret names that need to be fetched.
 */
export function collectSecretReferences(inputValues: Record<string, unknown>): Set<string> {
  const secrets = new Set<string>();
  for (const value of Object.values(inputValues)) {
    if (isSecretReference(value)) {
      secrets.add(extractSecretName(value));
    }
  }
  return secrets;
}

/** Resolve input placeholders at dispatch time without coercing exact values. */
export function resolveInputTemplates(
  value: unknown,
  inputValues: Record<string, unknown>,
  depth = 0
): unknown {
  if (depth > 12) throw new RunbookDefinitionError('Step configuration is nested too deeply.');
  if (Array.isArray(value)) {
    return value.map(item => resolveInputTemplates(item, inputValues, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        resolveInputTemplates(nested, inputValues, depth + 1),
      ])
    );
  }
  if (typeof value !== 'string') return value;

  const exact = value.match(INPUT_TEMPLATE);
  if (exact) {
    if (!Object.prototype.hasOwnProperty.call(inputValues, exact[1])) {
      throw new RunbookDefinitionError(`Missing required runbook input "${exact[1]}".`);
    }
    return Object.getOwnPropertyDescriptor(inputValues, exact[1])?.value as unknown;
  }
  return value.replace(INPUT_TEMPLATE_GLOBAL, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(inputValues, key)) {
      throw new RunbookDefinitionError(`Missing required runbook input "${key}".`);
    }
    const resolved: unknown = Object.getOwnPropertyDescriptor(inputValues, key)?.value;
    if (!['string', 'number', 'boolean'].includes(typeof resolved)) {
      throw new RunbookDefinitionError(
        `Runbook input "${key}" must be scalar when embedded in text.`
      );
    }
    return String(resolved);
  });
}

export function containsSecretReference(value: unknown): boolean {
  if (isSecretReference(value)) return true;
  if (Array.isArray(value)) return value.some(containsSecretReference);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsSecretReference);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation summary
// ---------------------------------------------------------------------------

export interface DefinitionValidationResult {
  valid: boolean;
  stepCount: number;
  maxRisk: RunbookRiskClass;
  requiresAgent: boolean;
  requiresApproval: boolean;
  stepKeys: string[];
  errors: string[];
}

/**
 * Performs a comprehensive validation of a runbook definition and returns
 * a summary suitable for UI display.
 */
export function validateDefinition(raw: unknown): DefinitionValidationResult {
  const errors: string[] = [];

  const parseResult = runbookDefinitionSchema.safeParse(raw);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    return {
      valid: false,
      stepCount: 0,
      maxRisk: 'READ_ONLY',
      requiresAgent: false,
      requiresApproval: false,
      stepKeys: [],
      errors,
    };
  }

  const definition = parseResult.data as RunbookDefinition;

  try {
    validateDefinitionStructure(definition);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid runbook structure.');
  }

  // Check step key uniqueness
  const keys = new Set<string>();
  for (const step of flattenSteps(definition)) {
    if (keys.has(step.key)) {
      errors.push(`Duplicate step key: "${step.key}"`);
    }
    keys.add(step.key);
  }

  return {
    valid: errors.length === 0,
    stepCount: definition.steps.length,
    maxRisk: getMaxRiskClass(definition),
    requiresAgent: requiresAnyAgent(definition),
    requiresApproval: requiresAnyApproval(definition),
    stepKeys: [...keys],
    errors,
  };
}

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)])
    );
  }
  return value;
}
