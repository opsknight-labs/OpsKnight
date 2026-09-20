import type { FrameworkRequirement } from '../types';

export const ccpaRequirements: readonly FrameworkRequirement[] = [
  {
    id: 'CCPA-RIGHT-TO-KNOW',
    framework: 'CCPA',
    reference: 'Cal. Civ. Code § 1798.100, 1798.110',
    title: 'Consumer Right to Know Personal Information Collected',
    summary:
      'Consumers have the right to request that a business disclose the categories and specific pieces of personal information that it has collected, sources from which it was collected, business purposes, and third parties with whom it was shared.',
    sourceUrl: 'https://www.oag.ca.gov/privacy/ccpa',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'CCPA-RIGHT-TO-DELETE',
    framework: 'CCPA',
    reference: 'Cal. Civ. Code § 1798.105',
    title: 'Consumer Right to Request Deletion',
    summary:
      'Consumers have the right to request deletion of personal information collected by the business, subject to statutory exceptions such as completing transactions, detecting security incidents, or complying with legal obligations.',
    sourceUrl: 'https://www.oag.ca.gov/privacy/ccpa',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'CCPA-RETENTION-LIMITATION',
    framework: 'CCPA',
    reference: 'Cal. Civ. Code § 1798.100(a)(3)',
    title: 'Retention Limitation and Purpose Compatibility',
    summary:
      'A business shall not retain a consumer personal information or sensitive personal information for each disclosed purpose for longer than is reasonably necessary and proportionate for that purpose.',
    sourceUrl: 'https://www.oag.ca.gov/privacy/ccpa',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'CCPA-REASONABLE-SECURITY',
    framework: 'CCPA',
    reference: 'Cal. Civ. Code § 1798.100(e)',
    title: 'Duty to Maintain Reasonable Security Procedures',
    summary:
      'A business that collects a consumer personal information shall implement reasonable security procedures and practices appropriate to the nature of the personal information to protect the personal information from unauthorized access, destruction, use, modification, or disclosure.',
    sourceUrl: 'https://www.oag.ca.gov/privacy/ccpa',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
] as const;
