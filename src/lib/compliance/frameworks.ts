import type { ComplianceFramework } from './types';

export const frameworks = [
  {
    id: 'CRA',
    title: 'Cyber Resilience Act',
    scope: 'Product security and vulnerability handling',
    source: 'https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act',
  },
  {
    id: 'GDPR',
    title: 'General Data Protection Regulation',
    scope: 'Personal data processing and individual rights',
    source: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
  },
  {
    id: 'SOC2',
    title: 'SOC 2',
    scope: 'Trust Services Criteria; organizational attestation',
    source: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
  },
  {
    id: 'ISO27001',
    title: 'ISO/IEC 27001:2022',
    scope: 'Information security management system',
    source: 'https://www.iso.org/standard/27001',
  },
  {
    id: 'ISO27701',
    title: 'ISO/IEC 27701:2025',
    scope: 'Privacy information management system',
    source: 'https://www.iso.org/standard/27701',
  },
  {
    id: 'DPDP',
    title: 'Digital Personal Data Protection',
    scope: 'India; applicability and commencement require organizational assessment',
    source:
      'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
  },
  {
    id: 'CCPA',
    title: 'California Consumer Privacy Act',
    scope: 'California privacy rights, as amended; applicability requires assessment',
    source: 'https://www.oag.ca.gov/privacy/ccpa',
  },
] as const satisfies readonly {
  id: ComplianceFramework;
  title: string;
  scope: string;
  source: string;
}[];
