export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'PERSONAL',
  'SENSITIVE',
  'SECRET',
] as const;

export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/**
 * OpsKnight information-handling labels. In particular, SENSITIVE means
 * elevated internal handling and does not assert that data is GDPR Article 9
 * special-category personal data or an equivalent statutory category.
 */
export type PrivacyDataLocation = 'DATABASE' | 'LOG' | 'EXTERNAL_PROVIDER' | 'FREE_TEXT';

export interface PersonalDataDomain {
  readonly domain: string;
  readonly models: readonly string[];
  readonly fields: readonly string[];
  readonly purpose: readonly string[];
  readonly classifications: readonly DataClassification[];
  readonly locations: readonly PrivacyDataLocation[];
  readonly retention: {
    readonly current: string;
    readonly target: string;
  };
  readonly discoverable: 'COUNTED' | 'PARTIAL' | 'NOT_COUNTED';
  readonly notes: readonly string[];
}
