import type { FrameworkRequirement } from '../types';

export const iso27001Requirements: readonly FrameworkRequirement[] = [
  {
    id: 'ISO27001-A-ACCESS-CONTROL',
    framework: 'ISO27001',
    reference: 'Control A.5.15 & A.8.2',
    title: 'Access Control & Privileged Access Rights',
    summary:
      'Rules to control physical and logical access to information and system assets are established and implemented in accordance with access control and authentication policy.',
    sourceUrl: 'https://www.iso.org/standard/27001',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'ISO27001-A-CRYPTOGRAPHY',
    framework: 'ISO27001',
    reference: 'Control A.8.24',
    title: 'Use of Cryptography',
    summary:
      'Rules for the effective use of cryptography, including cryptographic key management and envelope protection, are defined and implemented throughout data lifecycles.',
    sourceUrl: 'https://www.iso.org/standard/27001',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'ISO27001-A-SECURE-DEVELOPMENT',
    framework: 'ISO27001',
    reference: 'Control A.8.25, A.8.28',
    title: 'Secure Development Lifecycle & Vulnerability Management',
    summary:
      'Information security is designed and implemented within the software development lifecycle, including automated testing, static analysis, and third-party component screening.',
    sourceUrl: 'https://www.iso.org/standard/27001',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'ISO27001-A-BACKUP-RECOVERY',
    framework: 'ISO27001',
    reference: 'Control A.8.13',
    title: 'Information Backup',
    summary:
      'Backup copies of information, software, and systems are maintained and regularly tested in accordance with agreed backup and restoration procedures.',
    sourceUrl: 'https://www.iso.org/standard/27001',
    lifecycle: 'ACTIVE',
    applicability: 'OPERATOR',
  },
  {
    id: 'ISO27001-A-LOGGING-MONITORING',
    framework: 'ISO27001',
    reference: 'Control A.8.15',
    title: 'Logging and Operational Monitoring',
    summary:
      'Logs that record activities, exceptions, faults, and other relevant security events are generated, stored, protected, and analyzed.',
    sourceUrl: 'https://www.iso.org/standard/27001',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
] as const;
