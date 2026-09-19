import type { ComplianceFrameworkDefinition } from './types';

export const COMPLIANCE_FRAMEWORK_DEFINITIONS: readonly ComplianceFrameworkDefinition[] = [
  {
    id: 'GDPR',
    title: 'General Data Protection Regulation',
    version: 'Regulation (EU) 2016/679',
    jurisdiction: 'European Union',
    frameworkType: 'REGULATION',
    authoritativeSource: 'EUR-Lex',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    notes: 'Official regulation text as published in the Official Journal of the European Union.',
  },
  {
    id: 'CRA',
    title: 'Cyber Resilience Act',
    version: 'Regulation (EU) 2024/2847',
    jurisdiction: 'European Union',
    frameworkType: 'REGULATION',
    authoritativeSource: 'EUR-Lex',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2024/2847/2024-11-20/eng',
    notes:
      'Regulation on horizontal cybersecurity requirements for products with digital elements.',
  },
  {
    id: 'SOC2',
    title: 'SOC 2 Trust Services Criteria',
    version: '2017 TSC — Revised Points of Focus 2022',
    jurisdiction: 'United States / International',
    frameworkType: 'ATTESTATION_CRITERIA',
    authoritativeSource: 'AICPA',
    sourceUrl: 'https://www.aicpa-cima.com/resources/toolkit/trust-services-criteria',
    notes: 'AICPA Trust Services Criteria for Security, Availability, and Confidentiality.',
  },
  {
    id: 'ISO27001',
    title: 'ISO/IEC 27001:2022',
    version: 'ISO/IEC 27001:2022',
    jurisdiction: 'International',
    frameworkType: 'STANDARD',
    authoritativeSource: 'ISO',
    sourceUrl: 'https://www.iso.org/standard/27001',
    notes: 'International standard for Information Security Management Systems (ISMS).',
  },
  {
    id: 'ISO27701',
    title: 'ISO/IEC 27701:2019',
    version: 'ISO/IEC 27701:2019',
    jurisdiction: 'International',
    frameworkType: 'STANDARD',
    authoritativeSource: 'ISO',
    sourceUrl: 'https://www.iso.org/standard/71670.html',
    notes:
      'ISO/IEC 27701:2019 (Edition 1) PIMS standard. Clause mappings reference the 2019 structure (clauses 6-7). Transition to Edition 2 (ISO/IEC 27701:2025) will take place once licensed Annex A control tables are formally mapped.',
  },
  {
    id: 'DPDP',
    title: 'Digital Personal Data Protection',
    version: 'DPDP Act 2023 + DPDP Rules 2025',
    jurisdiction: 'India',
    frameworkType: 'LAW',
    authoritativeSource: 'MeitY',
    sourceUrl:
      'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    notes: 'Indian statutory framework; Rules 2025 have staged commencement over 1 to 18 months.',
  },
  {
    id: 'CCPA',
    title: 'California Consumer Privacy Act',
    version: 'CCPA as amended by CPRA',
    jurisdiction: 'California, United States',
    frameworkType: 'LAW',
    authoritativeSource: 'California Department of Justice',
    sourceUrl: 'https://www.oag.ca.gov/privacy/ccpa',
    notes:
      'California statutory privacy framework establishing consumer privacy rights and business obligations.',
  },
] as const;
