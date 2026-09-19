import type { FrameworkRequirement } from '../types';

export const iso27701Requirements: readonly FrameworkRequirement[] = [
  {
    id: 'ISO27701-PII-SECURITY',
    framework: 'ISO27701',
    reference: 'Clause 6.5',
    title: 'Information Security Safeguards for PII',
    summary:
      'Organizations acting as PII controllers must implement technical safeguards, access boundaries, and transmission protections to safeguard personally identifiable information under ISO/IEC 27701:2019.',
    sourceUrl: 'https://www.iso.org/standard/71670.html',
    effectiveUntil: '2025-10-14',
    lifecycle: 'SUPERSEDED',
    applicability: 'SHARED',
  },
  {
    id: 'ISO27701-RETENTION-DISPOSAL',
    framework: 'ISO27701',
    reference: 'Clause 7.2.8',
    title: 'PII Retention and Disposal',
    summary:
      'Organizations must define retention schedules and ensure personal data is securely destroyed or de-identified when retention periods expire, unless legal holds require preservation under ISO/IEC 27701:2019.',
    sourceUrl: 'https://www.iso.org/standard/71670.html',
    effectiveUntil: '2025-10-14',
    lifecycle: 'SUPERSEDED',
    applicability: 'SHARED',
  },
  {
    id: 'ISO27701-PII-SUBJECT-RIGHTS',
    framework: 'ISO27701',
    reference: 'Clause 7.3.2, 7.3.3',
    title: 'Obligations to PII Principals (Access and Erasure)',
    summary:
      'Organizations must provide mechanisms to enable PII principals to access, correct, and request erasure of their personal data in a timely manner under ISO/IEC 27701:2019.',
    sourceUrl: 'https://www.iso.org/standard/71670.html',
    effectiveUntil: '2025-10-14',
    lifecycle: 'SUPERSEDED',
    applicability: 'SHARED',
  },
  {
    id: 'ISO27701-PRIVACY-BY-DESIGN',
    framework: 'ISO27701',
    reference: 'Clause 7.4.2',
    title: 'Privacy by Design and Default',
    summary:
      'Systems and processing mechanisms are designed to collect and retain only the minimum necessary personal data and protect confidentiality by default under ISO/IEC 27701:2019.',
    sourceUrl: 'https://www.iso.org/standard/71670.html',
    effectiveUntil: '2025-10-14',
    lifecycle: 'SUPERSEDED',
    applicability: 'PRODUCT',
  },
] as const;
