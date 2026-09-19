import type { ComplianceFramework } from '../types';
import type {
  ComplianceFrameworkDefinition,
  FrameworkRequirement,
  FrameworkControlMapping,
} from './types';
import { COMPLIANCE_FRAMEWORK_DEFINITIONS } from './frameworks';
import { ALL_FRAMEWORK_REQUIREMENTS } from './requirements';
import { ALL_FRAMEWORK_CONTROL_MAPPINGS } from './mappings';

export const frameworkDefinitionRegistry = new Map<
  ComplianceFramework,
  ComplianceFrameworkDefinition
>();

for (const def of COMPLIANCE_FRAMEWORK_DEFINITIONS) {
  frameworkDefinitionRegistry.set(def.id, def);
}

export const frameworkRequirementRegistry = new Map<string, FrameworkRequirement>();

for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
  frameworkRequirementRegistry.set(req.id, req);
}

export const frameworkControlMappings: readonly FrameworkControlMapping[] =
  ALL_FRAMEWORK_CONTROL_MAPPINGS;

export function getFramework(id: ComplianceFramework): ComplianceFrameworkDefinition | undefined {
  return frameworkDefinitionRegistry.get(id);
}

export function getAllFrameworks(): readonly ComplianceFrameworkDefinition[] {
  return COMPLIANCE_FRAMEWORK_DEFINITIONS;
}

export function getFrameworkRequirements(
  framework: ComplianceFramework
): readonly FrameworkRequirement[] {
  return ALL_FRAMEWORK_REQUIREMENTS.filter(req => req.framework === framework);
}

export function getFrameworkRequirement(requirementId: string): FrameworkRequirement | undefined {
  return frameworkRequirementRegistry.get(requirementId);
}

export function getMappingsForRequirement(
  requirementId: string
): readonly FrameworkControlMapping[] {
  return frameworkControlMappings.filter(mapping => mapping.requirementId === requirementId);
}

export function getMappingsForControl(controlId: string): readonly FrameworkControlMapping[] {
  return frameworkControlMappings.filter(mapping => mapping.controlId === controlId);
}

export function getFrameworksForControl(controlId: string): readonly ComplianceFramework[] {
  const frameworks = new Set<ComplianceFramework>();
  for (const mapping of frameworkControlMappings) {
    if (mapping.controlId === controlId) {
      frameworks.add(mapping.framework);
    }
  }
  return Array.from(frameworks);
}
