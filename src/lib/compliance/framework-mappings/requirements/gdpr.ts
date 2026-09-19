import type { FrameworkRequirement } from '../types';

export const gdprRequirements: readonly FrameworkRequirement[] = [
  {
    id: 'GDPR-ART-32',
    framework: 'GDPR',
    reference: 'Article 32',
    title: 'Security of Processing',
    summary:
      'Requires implementation of appropriate technical and organizational measures to ensure a level of security appropriate to risk, including encryption of personal data, continuous confidentiality, integrity, availability, and resilience of processing systems, restoration capabilities, and regular testing.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'GDPR-ART-15',
    framework: 'GDPR',
    reference: 'Article 15',
    title: 'Right of Access by the Data Subject',
    summary:
      'Gives data subjects the right to obtain confirmation as to whether personal data concerning them are being processed, access to that personal data, and a portable copy of personal data undergoing processing.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'GDPR-ART-17',
    framework: 'GDPR',
    reference: 'Article 17',
    title: 'Right to Erasure (Right to be Forgotten)',
    summary:
      'Obligates controllers to erase personal data without undue delay where grounds such as purpose expiration or consent withdrawal apply, subject to lawful retention exceptions and legal holds.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'GDPR-ART-5-1-E',
    framework: 'GDPR',
    reference: 'Article 5(1)(e)',
    title: 'Storage Limitation Principle',
    summary:
      'Mandates that personal data must be kept in a form which permits identification of data subjects for no longer than is necessary for the purposes for which the personal data are processed.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    lifecycle: 'ACTIVE',
    applicability: 'SHARED',
  },
  {
    id: 'GDPR-ART-30',
    framework: 'GDPR',
    reference: 'Article 30',
    title: 'Records of Processing Activities',
    summary:
      'Requires maintenance of documented records of processing operations, data categories, recipient classifications, and security measure overviews.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    lifecycle: 'ACTIVE',
    applicability: 'ORGANIZATION',
  },
  {
    id: 'GDPR-ART-33',
    framework: 'GDPR',
    reference: 'Article 33',
    title: 'Notification of a Personal Data Breach',
    summary:
      'Requires documented incident response and notification of personal data breaches to supervisory authorities without undue delay upon becoming aware.',
    sourceUrl: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    lifecycle: 'ACTIVE',
    applicability: 'OPERATOR',
  },
] as const;
