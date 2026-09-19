import type { FrameworkRequirement } from '../types';

export const craRequirements: readonly FrameworkRequirement[] = [
  {
    id: 'CRA-ANNEX-I-SECURITY',
    framework: 'CRA',
    reference: 'Annex I, Section 1',
    title: 'Essential Cybersecurity Requirements for Products with Digital Elements',
    summary:
      'Products with digital elements must be designed, developed, and produced to ensure an appropriate level of cybersecurity based on risks, including protection of data confidentiality through encryption, prevention of unauthorized access, integrity verification, and secure default configurations.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2024/2847/2024-11-20/eng',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'CRA-VULN-HANDLING',
    framework: 'CRA',
    reference: 'Annex I, Section 2',
    title: 'Vulnerability Handling Requirements',
    summary:
      'Manufacturers must identify, document, and remediate vulnerabilities without delay, perform regular security tests, record dependency vulnerabilities, and establish coordinated disclosure policies.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2024/2847/2024-11-20/eng',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'CRA-SBOM-DOCUMENTATION',
    framework: 'CRA',
    reference: 'Annex I, Section 2(1)',
    title: 'Software Bill of Materials (SBOM)',
    summary:
      'Requires drawing up an inventory of software components and third-party dependencies in an industry-standard machine-readable format covering top-level and transitive dependencies.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2024/2847/2024-11-20/eng',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
  {
    id: 'CRA-SUPPORT-LIFECYCLE',
    framework: 'CRA',
    reference: 'Article 13 & Annex I',
    title: 'Support Period and Security Updates',
    summary:
      'Manufacturers must determine and declare a security support period during which security updates and vulnerability fixes are delivered free of charge.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2024/2847/2024-11-20/eng',
    lifecycle: 'ACTIVE',
    applicability: 'PRODUCT',
  },
] as const;
