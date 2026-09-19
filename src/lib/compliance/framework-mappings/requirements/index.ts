import type { FrameworkRequirement } from '../types';
import { gdprRequirements } from './gdpr';
import { craRequirements } from './cra';
import { soc2Requirements } from './soc2';
import { iso27001Requirements } from './iso27001';
import { iso27701Requirements } from './iso27701';
import { dpdpRequirements } from './dpdp';
import { ccpaRequirements } from './ccpa';

export * from './gdpr';
export * from './cra';
export * from './soc2';
export * from './iso27001';
export * from './iso27701';
export * from './dpdp';
export * from './ccpa';

export const ALL_FRAMEWORK_REQUIREMENTS: readonly FrameworkRequirement[] = [
  ...gdprRequirements,
  ...craRequirements,
  ...soc2Requirements,
  ...iso27001Requirements,
  ...iso27701Requirements,
  ...dpdpRequirements,
  ...ccpaRequirements,
];
