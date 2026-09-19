import type { FrameworkControlMapping } from '../types';
import { gdprMappings } from './gdpr';
import { craMappings } from './cra';
import { soc2Mappings } from './soc2';
import { iso27001Mappings } from './iso27001';
import { iso27701Mappings } from './iso27701';
import { dpdpMappings } from './dpdp';
import { ccpaMappings } from './ccpa';

export * from './gdpr';
export * from './cra';
export * from './soc2';
export * from './iso27001';
export * from './iso27701';
export * from './dpdp';
export * from './ccpa';

export const ALL_FRAMEWORK_CONTROL_MAPPINGS: readonly FrameworkControlMapping[] = [
  ...gdprMappings,
  ...craMappings,
  ...soc2Mappings,
  ...iso27001Mappings,
  ...iso27701Mappings,
  ...dpdpMappings,
  ...ccpaMappings,
];
