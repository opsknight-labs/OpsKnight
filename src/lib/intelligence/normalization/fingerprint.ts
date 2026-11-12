import { canonicalizeLabels, type CanonicalLabels } from './labels';
import { extractTokens, maskVolatileText } from './text';

export interface FingerprintInput {
  title: string;
  description?: string | null;
  /** Alert custom details / labels, in whatever shape the integration produced. */
  labelSource?: unknown;
}

export interface IncidentFingerprintData {
  template: string;
  tokens: string[];
  labels: CanonicalLabels;
}

/**
 * Builds the stored fingerprint. The template comes from the title alone (stable across updates to
 * the description); tokens also use the description so similarity can match richer context.
 */
export function buildIncidentFingerprint(input: FingerprintInput): IncidentFingerprintData {
  const template = maskVolatileText(input.title);
  const tokenSource = input.description ? `${template} ${maskVolatileText(input.description)}` : template;
  return {
    template,
    tokens: extractTokens(tokenSource),
    labels: canonicalizeLabels(input.labelSource),
  };
}
