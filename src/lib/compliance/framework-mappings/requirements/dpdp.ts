import type { FrameworkRequirement } from '../types';

export const dpdpRequirements: readonly FrameworkRequirement[] = [
  {
    id: 'DPDP-SECURITY-SAFEGUARDS',
    framework: 'DPDP',
    reference: 'Section 8(5)',
    title: 'Reasonable Security Safeguards',
    summary:
      'A Data Fiduciary must implement reasonable security safeguards to prevent personal data breaches in its possession or under its control, including during processing undertaken by a Data Processor.',
    sourceUrl:
      'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'DPDP-ERASURE',
    framework: 'DPDP',
    reference: 'Section 12(3) & Rules 2025',
    title: 'Right to Correction and Erasure of Personal Data',
    summary:
      'A Data Principal has the right to correction, completion, updating, and erasure of personal data that is no longer necessary for the purpose for which it was processed, subject to legal compliance exceptions.',
    sourceUrl:
      'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'DPDP-RETENTION-SPECIFIED',
    framework: 'DPDP',
    reference: 'Section 8(7) & Rule 4',
    title: 'Erasure upon Purpose Completion or Consent Withdrawal',
    summary:
      'A Data Fiduciary must erase personal data upon purpose completion or upon the Data Principal withdrawing consent, in accordance with the staged commencement timeline set forth in Rule 4.',
    sourceUrl:
      'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    effectiveFrom: '2026-11-13',
    lifecycle: 'FUTURE',
    applicability: 'SHARED',
  },
  {
    id: 'DPDP-GRIEVANCE-REDRESSAL',
    framework: 'DPDP',
    reference: 'Section 13 & Rule 14',
    title: 'Grievance Redressal Mechanism',
    summary:
      'A Data Fiduciary must provide an easily accessible grievance redressal mechanism allowing Data Principals to seek resolution of grievances, subject to the 18-month staged commencement of Rule 14.',
    sourceUrl:
      'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    effectiveFrom: '2027-05-13',
    lifecycle: 'FUTURE',
    applicability: 'OPERATOR',
  },
] as const;
