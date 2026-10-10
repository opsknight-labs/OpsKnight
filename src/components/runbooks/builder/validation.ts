import type { RunbookDefinition, RunbookStepDefinition } from '@/lib/runbooks/types';
import { runbookInputsSchema, type RunbookInputInput } from '@/lib/runbooks/schemas';
import { flattenSteps } from '@/lib/runbooks/definition';

export const INPUT_TEMPLATE = /^\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}$/;
export const SYSTEMD_UNIT =
  /^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.(?:service|socket|timer|target|mount|path|slice|scope|device|automount|swap)$/;
export const DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
// RFC 1123 DNS label: lowercase alphanumeric, hyphens/periods allowed in middle, start/end alphanumeric
export const KUBERNETES_NAME = /^(?:[a-z0-9]|[a-z0-9][a-z0-9.-]*[a-z0-9])$/;
export const STEP_KEY_REGEX = /^[a-z0-9_-]{1,80}$/;

export interface StepValidationResult {
  errors: Record<string, string>;
  isValid: boolean;
}

export function checkInputTemplate(val: string, inputs?: RunbookInputInput[]): string | null {
  const match = val.match(INPUT_TEMPLATE);
  if (match && inputs && inputs.length > 0) {
    const inputKey = match[1];
    if (!inputs.some(i => i.key === inputKey)) {
      return `Referenced input "${inputKey}" is not declared in the Inputs tab.`;
    }
  }
  return null;
}

export function validateStep(
  step: RunbookStepDefinition,
  inputs: RunbookInputInput[] = [],
  allStepKeys: string[] = []
): StepValidationResult {
  const errors: Record<string, string> = {};

  // Core metadata
  if (!step.name || step.name.trim().length === 0) {
    errors.name = 'Step name is required.';
  } else if (step.name.length > 200) {
    errors.name = 'Step name must not exceed 200 characters.';
  }

  if (!step.key || step.key.trim().length === 0) {
    errors.key = 'Step key is required.';
  } else if (!STEP_KEY_REGEX.test(step.key)) {
    errors.key = 'Key must be lowercase alphanumeric with underscores or hyphens (max 80 chars).';
  } else if (allStepKeys.filter(k => k === step.key).length > 1) {
    errors.key = 'Step key must be unique across the runbook.';
  }

  if (step.timeoutSeconds !== undefined) {
    if (!Number.isInteger(step.timeoutSeconds) || step.timeoutSeconds < 1 || step.timeoutSeconds > 86400) {
      errors.timeoutSeconds = 'Timeout must be an integer between 1 and 86,400 seconds.';
    }
  }

  // Type-specific config validation
  const config = step.config ?? {};

  switch (step.type) {

    case 'HTTP': {
      const method = String(config.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        errors.method = 'Unsupported HTTP method.';
      }
      const url = String(config.url ?? '').trim();
      if (!url) {
        errors.url = 'HTTP URL or input reference is required.';
      } else if (!INPUT_TEMPLATE.test(url)) {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            errors.url = 'URL must use http:// or https:// protocol.';
          } else if (parsed.username || parsed.password) {
            errors.url = 'HTTP URL must not contain embedded credentials.';
          }
        } catch {
          errors.url = 'Invalid URL format. Use full URL (e.g., https://api.service/health) or ${{ inputs.key }}.';
        }
      } else {
        const templateErr = checkInputTemplate(url, inputs);
        if (templateErr) errors.url = templateErr;
      }
      if (config.headers !== undefined) {
        if (typeof config.headers !== 'object' || config.headers === null || Array.isArray(config.headers)) {
          errors.headers = 'HTTP headers must be an object.';
        }
      }
      if (config.body !== undefined) {
        const bodyStr = typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
        if (new TextEncoder().encode(bodyStr).length > 64 * 1024) {
          errors.body = 'HTTP body exceeds maximum allowed size of 64 KiB.';
        }
      }
      break;
    }

    case 'SYSTEMD': {
      const unit = String(config.unit ?? '').trim();
      if (!unit || unit.startsWith('-')) {
        errors.unit = 'Service unit name is required (e.g. app.service).';
      } else if (!INPUT_TEMPLATE.test(unit) && !SYSTEMD_UNIT.test(unit)) {
        errors.unit = 'Unit must end in .service, .socket, .timer, etc. (e.g., payments.service).';
      }

      if (config.action === 'logs' && config.lines !== undefined) {
        const lines = Number(config.lines);
        if (!Number.isInteger(lines) || lines < 1 || lines > 500) {
          errors.lines = 'Log lines must be an integer between 1 and 500.';
        }
      }
      break;
    }

    case 'DOCKER': {
      const container = String(config.container ?? '').trim();
      if (!container || container.startsWith('-')) {
        errors.container = 'Container name or input reference is required.';
      } else if (!INPUT_TEMPLATE.test(container) && !DOCKER_NAME.test(container)) {
        errors.container = 'Invalid container name format.';
      }
      break;
    }

    case 'KUBERNETES': {
      const action = String(config.action ?? 'get');
      const rawNamespace = config.namespace;
      const namespace = rawNamespace !== undefined ? String(rawNamespace).trim() : 'default';
      const resource = String(config.resource ?? '').trim();
      const name = String(config.name ?? '').trim();

      if (
        !namespace ||
        namespace.startsWith('-') ||
        (!INPUT_TEMPLATE.test(namespace) && !KUBERNETES_NAME.test(namespace))
      ) {
        errors.namespace = 'Invalid namespace format (DNS-1123 label).';
      }

      if (!resource || resource.startsWith('-')) {
        errors.resource = 'Resource type is required (e.g., deployment, pod).';
      } else if (!INPUT_TEMPLATE.test(resource) && !KUBERNETES_NAME.test(resource)) {
        errors.resource = 'Invalid resource type format.';
      } else if (!INPUT_TEMPLATE.test(resource)) {
        const lowerRes = resource.toLowerCase();
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
          if (!allowedLogResources.includes(lowerRes)) {
            errors.resource = `Kubernetes logs action does not support resource "${resource}". Supported resources are Pod, Deployment, DaemonSet, and StatefulSet.`;
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
          if (!allowedRolloutResources.includes(lowerRes)) {
            errors.resource = `Kubernetes ${action} does not support resource "${resource}". Supported resources are Deployment, DaemonSet, and StatefulSet.`;
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
          if (!allowedScaleResources.includes(lowerRes)) {
            errors.resource = `Kubernetes scale action does not support resource "${resource}". Supported resources are Deployment, StatefulSet, ReplicaSet, and ReplicationController.`;
          }
        }
      }

      if (['logs', 'rollout-restart', 'rollout-status', 'scale'].includes(action) && !name) {
        errors.resourceName = `Resource name is required for Kubernetes ${action}.`;
      } else if (name && (name.startsWith('-') || (!INPUT_TEMPLATE.test(name) && !KUBERNETES_NAME.test(name)))) {
        errors.resourceName = 'Invalid resource name format (DNS-1123 label).';
      }

      if (action === 'scale') {
        if (config.replicas === undefined || config.replicas === null || String(config.replicas).trim() === '') {
          errors.replicas = 'Desired replicas is required for scale action.';
        } else if (!INPUT_TEMPLATE.test(String(config.replicas).trim())) {
          const replicas = Number(config.replicas);
          if (!Number.isInteger(replicas) || replicas < 0 || replicas > 10000) {
            errors.replicas = 'Desired replicas must be an integer between 0 and 10,000.';
          }
        } else {
          const match = String(config.replicas).trim().match(INPUT_TEMPLATE);
          if (match && inputs && inputs.length > 0) {
            const inputKey = match[1];
            const targetInput = inputs.find(i => i.key === inputKey);
            if (targetInput && targetInput.type !== 'NUMBER') {
              errors.replicas = `Replica parameter "${inputKey}" must be of type NUMBER (found ${targetInput.type}).`;
            }
          }
        }
      }
      break;
    }

    case 'LINUX_DIAGNOSTICS': {
      const diagnostic = String(config.diagnostic ?? 'summary');
      if (diagnostic === 'dns') {
        const hostname = String(config.hostname ?? '').trim();
        if (!hostname) errors.hostname = 'Hostname is required for DNS diagnostics.';
      } else if (diagnostic === 'tcp') {
        const host = String(config.host ?? '').trim();
        if (!host) errors.host = 'TCP host is required.';
        if (config.port === undefined || config.port === null || String(config.port).trim() === '') {
          errors.port = 'TCP port is required.';
        } else {
          const port = Number(config.port);
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            errors.port = 'Port must be between 1 and 65,535.';
          }
        }
      } else if (diagnostic === 'http') {
        const url = String(config.url ?? '').trim();
        if (!url) {
          errors.url = 'HTTP URL is required.';
        } else if (!INPUT_TEMPLATE.test(url)) {
          try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              errors.url = 'HTTP diagnostic URL must use HTTP(S) protocol.';
            } else if (parsed.username || parsed.password) {
              errors.url = 'HTTP diagnostic URL must not contain embedded credentials.';
            }
          } catch {
            errors.url = 'HTTP diagnostic requires a valid URL.';
          }
        } else {
          const err = checkInputTemplate(url, inputs);
          if (err) errors.url = err;
        }
        if (config.expectedStatus !== undefined && String(config.expectedStatus).trim() !== '') {
          const status = Number(config.expectedStatus);
          if (!Number.isInteger(status) || status < 100 || status > 599) {
            errors.expectedStatus = 'Expected HTTP status must be between 100 and 599.';
          }
        }
      } else if (diagnostic === 'journal') {
        const unit = String(config.unit ?? '').trim();
        if (!unit) errors.unit = 'Service unit is required for journal diagnostics.';
        if (config.lines !== undefined && String(config.lines).trim() !== '') {
          const lines = Number(config.lines);
          if (!Number.isInteger(lines) || lines < 1 || lines > 500) {
            errors.lines = 'Lines must be between 1 and 500.';
          }
        }
      } else if (diagnostic === 'process') {
        const pattern = String(config.pattern ?? '').trim();
        if (!pattern) errors.pattern = 'Process search pattern is required.';
      } else if (diagnostic === 'filesystem') {
        const path = String(config.path ?? '').trim();
        if (!path) errors.path = 'Filesystem path is required.';
      }
      break;
    }

    case 'BASH': {
      const command = String(config.command ?? '').trim();
      if (!command) {
        errors.command = 'Allowlisted command script is required.';
      } else if (new TextEncoder().encode(command).length > 8192) {
        errors.command = 'Bash command exceeds maximum allowed size of 8 KiB.';
      }
      break;
    }

    case 'WAIT': {
      if (config.durationSeconds === undefined || config.durationSeconds === null || String(config.durationSeconds).trim() === '') {
        errors.durationSeconds = 'Duration in seconds is required.';
      } else {
        const duration = Number(config.durationSeconds);
        if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
          errors.durationSeconds = 'Duration must be an integer between 1 and 3,600 seconds.';
        }
      }
      break;
    }

    case 'CONDITION': {
      const field = String(config.field ?? '').trim();
      if (!field) errors.field = 'Condition field is required.';
      const operator = String(config.operator ?? 'EQUALS');
      if (['EXISTS', 'NOT_EXISTS'].includes(operator)) {
        // Unary operator, no value needed
      } else if (['IN', 'NOT_IN'].includes(operator)) {
        if (!Array.isArray(config.value) || config.value.length === 0) {
          errors.value = 'In list comparison requires at least one value.';
        }
      } else {
        if (config.value === undefined || config.value === null || String(config.value).trim() === '') {
          errors.value = 'Comparison value is required for this operator.';
        } else if (Array.isArray(config.value)) {
          errors.value = 'Comparison value must be a scalar string or number, not an array.';
        }
      }
      break;
    }
  }

  const serializedConfig = JSON.stringify(step.config ?? {});
  const maxConfigBytes = step.type === 'HTTP' ? 96 * 1024 : 32 * 1024;
  if (new TextEncoder().encode(serializedConfig).length > maxConfigBytes) {
    errors.config = `Config exceeds maximum allowed size of ${step.type === 'HTTP' ? '96' : '32'} KiB.`;
  }

  // Prechecks & verifications validation
  if (step.precheck?.steps) {
    step.precheck.steps.forEach((check, index) => {
      const sub = validateStep(check, inputs, allStepKeys);
      if (!sub.isValid) {
        const errorList = Object.values(sub.errors).join('; ');
        errors[`precheck_${index}`] = `Precheck "${check.name}": ${errorList}`;
      }
    });
  }

  if (step.verification?.steps) {
    step.verification.steps.forEach((check, index) => {
      const sub = validateStep(check, inputs, allStepKeys);
      if (!sub.isValid) {
        const errorList = Object.values(sub.errors).join('; ');
        errors[`verification_${index}`] = `Verification "${check.name}": ${errorList}`;
      }
    });
  }

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function validateRunbook(
  definition: RunbookDefinition,
  inputs: RunbookInputInput[] = []
): {
  stepErrors: Map<number, Record<string, string>>;
  inputErrors: Map<number, Record<string, string>>;
  generalInputErrors: string[];
  hasErrors: boolean;
  errorCount: number;
} {
  const stepErrors = new Map<number, Record<string, string>>();
  const inputErrors = new Map<number, Record<string, string>>();
  const generalInputErrors: string[] = [];
  const allKeys = flattenSteps(definition).map(s => s.key);
  let errorCount = 0;

  definition.steps.forEach((step, index) => {
    const result = validateStep(step, inputs, allKeys);
    if (!result.isValid) {
      stepErrors.set(index, result.errors);
      errorCount += Object.keys(result.errors).length;
    }
  });

  // Track undeclared input references across all steps
  const declaredKeys = new Set(inputs.map(i => i.key));
  const flattened = flattenSteps(definition);

  if (flattened.length > 50) {
    generalInputErrors.push(
      `Runbook contains ${flattened.length} steps, exceeding the maximum limit of 50.`
    );
    errorCount++;
  }

  const serializedDef = JSON.stringify(definition);
  if (new TextEncoder().encode(serializedDef).length > 256 * 1024) {
    generalInputErrors.push('Runbook definition exceeds maximum allowed size of 256 KiB.');
    errorCount++;
  }

  flattened.forEach(step => {
    const stepSeenRefs = new Set<string>();
    const serialized = JSON.stringify(step.config ?? {});
    const matches = serialized.matchAll(/\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}/g);
    for (const match of matches) {
      const refKey = match[1];
      if (!declaredKeys.has(refKey) && !stepSeenRefs.has(refKey)) {
        stepSeenRefs.add(refKey);
        generalInputErrors.push(
          `Step "${step.name || step.key}" references undeclared input "${refKey}".`
        );
        errorCount++;
      }
    }

    if (step.type === 'CONDITION') {
      const field = String(step.config?.field ?? '');
      const condMatch = field.match(/^inputs?\.([a-z0-9_]+)$/);
      if (condMatch) {
        const refKey = condMatch[1];
        if (!declaredKeys.has(refKey) && !stepSeenRefs.has(refKey)) {
          stepSeenRefs.add(refKey);
          generalInputErrors.push(
            `Step "${step.name || step.key}" references undeclared input "${refKey}".`
          );
          errorCount++;
        }
      }
    }

    if (step.type === 'BASH') {
      const command = String(step.config?.command ?? '');
      const envMatches = command.matchAll(
        /(?:\$OPSKNIGHT_INPUT_|\${OPSKNIGHT_INPUT_|\bOPSKNIGHT_INPUT_)([A-Z0-9_]+)\b/g
      );
      for (const envMatch of envMatches) {
        const refKey = envMatch[1].toLowerCase();
        if (!declaredKeys.has(refKey) && !stepSeenRefs.has(refKey)) {
          stepSeenRefs.add(refKey);
          generalInputErrors.push(
            `Step "${step.name || step.key}" references undeclared input "${refKey}".`
          );
          errorCount++;
        }
      }
    }
  });

  // Validate typed inputs to include input schema errors in readiness
  const parsedInputs = runbookInputsSchema.safeParse(inputs);
  if (!parsedInputs.success) {
    for (const issue of parsedInputs.error.issues) {
      errorCount++;
      const index = typeof issue.path[0] === 'number' ? issue.path[0] : -1;
      const field = typeof issue.path[1] === 'string' ? issue.path[1] : 'key';
      if (index >= 0) {
        const current = inputErrors.get(index) ?? {};
        if (field === 'key') {
          current.key = issue.message;
        } else if (field === 'label') {
          current.label = issue.message;
        } else {
          current.general = issue.message;
        }
        inputErrors.set(index, current);
      } else {
        generalInputErrors.push(issue.message);
      }
    }
  }

  return {
    stepErrors,
    inputErrors,
    generalInputErrors,
    hasErrors: errorCount > 0,
    errorCount,
  };
}
