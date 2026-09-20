import type { FrameworkRequirement } from '../types';

export const soc2Requirements: readonly FrameworkRequirement[] = [
  {
    id: 'SOC2-CC6-LOGICAL-ACCESS',
    framework: 'SOC2',
    reference: 'Common Criteria 6.1, 6.2, 6.3',
    title: 'Logical Access Controls & User Registration',
    summary:
      'The entity implements logical access security software, infrastructure, and architectures over protected information assets to restrict access to authorized personnel, authenticate user identities, and revoke access upon termination.',
    sourceUrl: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'SOC2-CC6-ENCRYPTION',
    framework: 'SOC2',
    reference: 'Common Criteria 6.7',
    title: 'Data Transmission and Storage Protection',
    summary:
      'The entity restricts transmission, movement, and storage of confidential information to authorized internal and external parties through cryptographic protection and access barriers.',
    sourceUrl: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'SOC2-CC7-SYSTEM-OPERATIONS',
    framework: 'SOC2',
    reference: 'Common Criteria 7.1, 7.2, 7.3',
    title: 'System Operations & Vulnerability Detection',
    summary:
      'The entity uses detection and monitoring procedures to identify changes to configurations that result in the introduction of new vulnerabilities, operational anomalies, and security incidents.',
    sourceUrl: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'SOC2-CC8-CHANGE-MANAGEMENT',
    framework: 'SOC2',
    reference: 'Common Criteria 8.1',
    title: 'Change Management & System Integrity',
    summary:
      'The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and implements changes to infrastructure, data, software, and procedures.',
    sourceUrl: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'SOC2-A1-AVAILABILITY',
    framework: 'SOC2',
    reference: 'Availability Criteria A1.2',
    title: 'Data Backup, Recovery & Environmental Protection',
    summary:
      'The entity authorizes, designs, and implements environmental protections, software, data backup processes, and recovery infrastructure to meet its availability commitments.',
    sourceUrl: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
    lifecycle: 'ACTIVE',
    applicability: 'OPERATOR',
  },
] as const;
