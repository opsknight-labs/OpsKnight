import { complianceControls } from '../controls';
import type { ComplianceControlDefinition, ComplianceFramework } from '../types';
import type {
  ComplianceFrameworkDefinition,
  FrameworkRequirement,
  FrameworkControlMapping,
} from '../framework-mappings/types';
import {
  getAllFrameworks,
  getFramework,
  frameworkControlMappings,
  getFrameworkRequirements,
} from '../framework-mappings/registry';
import { ALL_FRAMEWORK_REQUIREMENTS } from '../framework-mappings/requirements';
import type { EvidencePackageScope } from './types';

export class UnknownControlIdError extends Error {
  constructor(readonly controlId: string) {
    super(`Unknown compliance control ID: ${controlId}`);
    this.name = 'UnknownControlIdError';
  }
}

export interface ResolvedExportScope {
  readonly controls: readonly ComplianceControlDefinition[];
  readonly frameworks: readonly ComplianceFrameworkDefinition[];
  readonly requirements: readonly FrameworkRequirement[];
  readonly mappings: readonly FrameworkControlMapping[];
}

export function resolveExportScope(scope: EvidencePackageScope): ResolvedExportScope {
  const controlMap = new Map<string, ComplianceControlDefinition>(
    complianceControls.map(c => [c.id, c])
  );

  if (scope.type === 'DEPLOYMENT') {
    const sortedControls = [...complianceControls].sort((a, b) => a.id.localeCompare(b.id));
    const allFrameworks = getAllFrameworks();
    const allReqs = [...ALL_FRAMEWORK_REQUIREMENTS].sort((a, b) => a.id.localeCompare(b.id));
    const allMappings = [...frameworkControlMappings].sort((a, b) => a.id.localeCompare(b.id));

    return {
      controls: sortedControls,
      frameworks: allFrameworks,
      requirements: allReqs,
      mappings: allMappings,
    };
  }

  if (scope.type === 'FRAMEWORK') {
    const fwDef = getFramework(scope.framework);
    if (!fwDef) {
      throw new Error(`Unknown compliance framework: ${scope.framework}`);
    }

    const requirements = getFrameworkRequirements(scope.framework);
    const sortedReqs = [...requirements].sort((a, b) => a.id.localeCompare(b.id));

    // Mappings for this framework
    const mappings = frameworkControlMappings
      .filter(m => m.framework === scope.framework)
      .sort((a, b) => a.id.localeCompare(b.id));

    // Controls mapped to this framework
    const controlIdSet = new Set<string>();
    for (const m of mappings) {
      controlIdSet.add(m.controlId);
    }
    // Also include any controls declaring this framework in their control definition
    for (const c of complianceControls) {
      if (c.frameworks.includes(scope.framework)) {
        controlIdSet.add(c.id);
      }
    }

    const controls = Array.from(controlIdSet)
      .map(id => controlMap.get(id))
      .filter((c): c is ComplianceControlDefinition => Boolean(c))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      controls,
      frameworks: [fwDef],
      requirements: sortedReqs,
      mappings,
    };
  }

  if (scope.type === 'CONTROLS') {
    const controls: ComplianceControlDefinition[] = [];
    for (const id of scope.controlIds) {
      const c = controlMap.get(id);
      if (!c) {
        throw new UnknownControlIdError(id);
      }
      controls.push(c);
    }
    controls.sort((a, b) => a.id.localeCompare(b.id));

    const controlIdSet = new Set(controls.map(c => c.id));
    const relevantMappings = frameworkControlMappings
      .filter(m => controlIdSet.has(m.controlId))
      .sort((a, b) => a.id.localeCompare(b.id));

    const reqIdSet = new Set(relevantMappings.map(m => m.requirementId));
    const requirements = ALL_FRAMEWORK_REQUIREMENTS.filter(r => reqIdSet.has(r.id)).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    const fwIdSet = new Set<string>();
    for (const c of controls) {
      for (const fw of c.frameworks) {
        fwIdSet.add(fw);
      }
    }
    for (const m of relevantMappings) {
      fwIdSet.add(m.framework);
    }

    const frameworks = Array.from(fwIdSet)
      .map(id => getFramework(id as ComplianceFramework))
      .filter((f): f is ComplianceFrameworkDefinition => Boolean(f))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      controls,
      frameworks,
      requirements,
      mappings: relevantMappings,
    };
  }

  throw new Error(`Unsupported export scope type: ${(scope as { readonly type?: string }).type}`);
}
