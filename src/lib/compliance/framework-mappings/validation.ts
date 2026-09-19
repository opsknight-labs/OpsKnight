import { complianceControls } from '../controls';
import { complianceEvaluatorRegistry } from '../evaluators';
import {
  frameworkDefinitionRegistry,
  frameworkRequirementRegistry,
  frameworkControlMappings,
} from './registry';
import { ALL_FRAMEWORK_REQUIREMENTS } from './requirements';

export class FrameworkMappingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameworkMappingValidationError';
  }
}

const ALLOWED_SOURCE_HOSTS = new Set([
  'eur-lex.europa.eu',
  'www.aicpa-cima.com',
  'www.iso.org',
  'www.meity.gov.in',
  'www.oag.ca.gov',
]);

/**
 * Validates integrity, referential foreign keys, and source provenance across all framework definitions,
 * requirements, and control mappings. Throws FrameworkMappingValidationError upon any invariant violation.
 */
export function validateFrameworkMappings(): void {
  // 1. Validate requirements integrity
  const requirementIds = new Set<string>();
  for (const req of ALL_FRAMEWORK_REQUIREMENTS) {
    if (requirementIds.has(req.id)) {
      throw new FrameworkMappingValidationError(`Duplicate requirement ID detected: "${req.id}"`);
    }
    requirementIds.add(req.id);

    if (!frameworkDefinitionRegistry.has(req.framework)) {
      throw new FrameworkMappingValidationError(
        `Requirement "${req.id}" references unregistered framework: "${req.framework}"`
      );
    }

    try {
      const url = new URL(req.sourceUrl);
      if (!ALLOWED_SOURCE_HOSTS.has(url.hostname)) {
        throw new FrameworkMappingValidationError(
          `Requirement "${req.id}" source URL host "${url.hostname}" is not in official allowlist`
        );
      }
    } catch (e) {
      if (e instanceof FrameworkMappingValidationError) throw e;
      throw new FrameworkMappingValidationError(
        `Requirement "${req.id}" has invalid source URL: "${req.sourceUrl}"`
      );
    }
  }

  // 2. Validate control existence
  const controlMap = new Map(complianceControls.map(c => [c.id, c]));

  // 3. Validate mappings integrity
  const mappingIds = new Set<string>();
  for (const mapping of frameworkControlMappings) {
    if (mappingIds.has(mapping.id)) {
      throw new FrameworkMappingValidationError(`Duplicate mapping ID detected: "${mapping.id}"`);
    }
    mappingIds.add(mapping.id);

    const req = frameworkRequirementRegistry.get(mapping.requirementId);
    if (!req) {
      throw new FrameworkMappingValidationError(
        `Mapping "${mapping.id}" references unknown requirementId: "${mapping.requirementId}"`
      );
    }

    if (req.framework !== mapping.framework) {
      throw new FrameworkMappingValidationError(
        `Mapping "${mapping.id}" framework "${mapping.framework}" mismatches requirement framework "${req.framework}"`
      );
    }

    const control = controlMap.get(mapping.controlId);
    if (!control) {
      throw new FrameworkMappingValidationError(
        `Mapping "${mapping.id}" references unknown controlId: "${mapping.controlId}"`
      );
    }

    // Verify runtime mappings target a valid evaluator
    if (mapping.evidenceExpectation === 'RUNTIME') {
      if (!control.evaluatorId) {
        throw new FrameworkMappingValidationError(
          `Mapping "${mapping.id}" expects RUNTIME evidence but control "${control.id}" lacks evaluatorId`
        );
      }
      if (!complianceEvaluatorRegistry[control.evaluatorId]) {
        throw new FrameworkMappingValidationError(
          `Mapping "${mapping.id}" evaluator "${control.evaluatorId}" is not registered in complianceEvaluatorRegistry`
        );
      }
    }
  }
}
