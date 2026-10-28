import { z } from 'zod/v4';
import { AI_DATA_CLASSES } from './port';

export const SQUIRE_AVATARS = ['ICON', 'KNIGHT', 'OWL', 'ROBOT'] as const;
export type SquireAvatar = (typeof SQUIRE_AVATARS)[number];
export const SQUIRE_LAUNCHERS = ['FLOATING', 'SEARCH_ONLY'] as const;
export type SquireLauncherStyle = (typeof SQUIRE_LAUNCHERS)[number];

export const AI_PROVIDER_KINDS = [
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'OPENAI_COMPATIBLE',
  'AZURE_OPENAI',
  'BEDROCK',
  'VERTEX',
  'MISTRAL',
  'GROQ',
] as const;
/** Kinds without an embeddings API. */
export const NO_EMBEDDING_KINDS: ReadonlySet<string> = new Set(['ANTHROPIC', 'GROQ']);

// Each of these ends up inside a vendor hostname or URL path, so it is held to the vendor's own syntax.
export const AWS_REGION = /^(?:us-gov|[a-z]{2})-[a-z]+-\d{1,2}$/;
export const GCP_LOCATION = /^(?:global|[a-z]+-[a-z]+\d{1,2})$/;
export const GCP_PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const AZURE_RESOURCE = /^[a-z0-9][a-z0-9-]{1,62}$/i;
export const AZURE_API_VERSION = /^\d{4}-\d{2}-\d{2}(?:-preview)?$/;
export const DATA_REGION = /^[a-z0-9][a-z0-9-]{0,31}$/;
export type AiProviderKindValue = (typeof AI_PROVIDER_KINDS)[number];

export const AI_SETTINGS_BOUNDS = {
  squireNameMax: 32,
  requestsPerMinute: { min: 1, max: 600 },
  dailyTokenBudget: { min: 1_000, max: 1_000_000_000 },
  maxOutputTokens: { min: 64, max: 8_192 },
  requestTimeoutMs: { min: 1_000, max: 120_000 },
} as const;

export const AI_SETTINGS_DEFAULTS = {
  enabled: false,
  squireEnabled: false,
  squireName: 'Squire',
  squireAvatar: 'ICON' as SquireAvatar,
  squireLauncher: 'FLOATING' as SquireLauncherStyle,
  squireAnimations: false,
  allowExternalFallback: false,
  requestsPerMinutePerUser: 20,
  dailyTokenBudget: 500_000,
  maxOutputTokens: 1_024,
  requestTimeoutMs: 30_000,
  allowedDataRegions: [] as string[],
  embeddingsEnabled: false,
  squireHistoryEnabled: false,
  squireHistoryRetentionDays: 30,
} as const;

/** The assistant's display name is rendered everywhere, so it is limited to plain, harmless text. */
const squireName = z
  .string()
  .trim()
  .min(1)
  .max(AI_SETTINGS_BOUNDS.squireNameMax)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} '’.-]*$/u, 'Use letters, numbers, spaces, apostrophes, dots or hyphens');

const intIn = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);

export const aiSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    squireEnabled: z.boolean(),
    squireName,
    squireAvatar: z.enum(SQUIRE_AVATARS).default('ICON'),
    squireLauncher: z.enum(SQUIRE_LAUNCHERS).default('FLOATING'),
    squireAnimations: z.boolean().default(false),
    allowExternalFallback: z.boolean(),
    requestsPerMinutePerUser: intIn(AI_SETTINGS_BOUNDS.requestsPerMinute),
    dailyTokenBudget: intIn(AI_SETTINGS_BOUNDS.dailyTokenBudget),
    maxOutputTokens: intIn(AI_SETTINGS_BOUNDS.maxOutputTokens),
    requestTimeoutMs: intIn(AI_SETTINGS_BOUNDS.requestTimeoutMs),
    allowedDataRegions: z
      .array(z.string().trim().toLowerCase().regex(DATA_REGION, 'Use lowercase letters, digits and hyphens'))
      .max(20)
      .default([])
      .transform(regions => [...new Set(regions)]),
    embeddingsEnabled: z.boolean().default(false),
    squireHistoryEnabled: z.boolean().default(false),
    squireHistoryRetentionDays: z.number().int().min(1).max(365).default(30),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

export const aiProviderInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    kind: z.enum(AI_PROVIDER_KINDS),
    model: z.string().trim().min(1).max(128),
    baseUrl: z.string().trim().max(500).nullish(),
    /** Omitted or empty on update means "keep the stored key". Never echoed back. */
    apiKey: z.string().trim().max(512).nullish(),
    enabled: z.boolean(),
    isExternal: z.boolean(),
    maxDataClass: z.enum(AI_DATA_CLASSES),
    allowPrivateNetwork: z.boolean(),
    priority: z.number().int().min(0).max(10_000),
    dataRegion: z.string().trim().toLowerCase().regex(DATA_REGION, 'Use lowercase letters, digits and hyphens').nullish(),
    embeddingModel: z.string().trim().min(1).max(128).nullish(),
    // Azure OpenAI
    azureResourceName: z.string().trim().regex(AZURE_RESOURCE, 'Not a valid Azure resource name').nullish(),
    azureApiVersion: z.string().trim().regex(AZURE_API_VERSION, 'Use a version such as 2024-10-21').nullish(),
    // Amazon Bedrock (credentials are secret and kept only encrypted)
    awsRegion: z.string().trim().regex(AWS_REGION, 'Not a valid AWS region').nullish(),
    awsAccessKeyId: z.string().trim().regex(/^[A-Z0-9]{16,128}$/, 'Not a valid access key ID').nullish(),
    awsSecretAccessKey: z.string().trim().min(16).max(256).nullish(),
    // Google Vertex AI
    gcpProject: z.string().trim().regex(GCP_PROJECT, 'Not a valid Google Cloud project ID').nullish(),
    gcpLocation: z.string().trim().regex(GCP_LOCATION, 'Not a valid Google Cloud location').nullish(),
    serviceAccountJson: z.string().trim().max(10_000).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'OPENAI_COMPATIBLE' && !value.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'A base URL is required for OpenAI-compatible endpoints' });
    }
    if (value.kind === 'AZURE_OPENAI' && !value.azureResourceName && !value.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['azureResourceName'], message: 'Enter the Azure resource name or a base URL' });
    }
    if (value.kind === 'BEDROCK' && !value.awsRegion) {
      ctx.addIssue({ code: 'custom', path: ['awsRegion'], message: 'An AWS region is required for Bedrock' });
    }
    if (value.kind === 'VERTEX' && (!value.gcpProject || !value.gcpLocation)) {
      ctx.addIssue({ code: 'custom', path: ['gcpProject'], message: 'A Google Cloud project and location are required for Vertex AI' });
    }
    if (value.embeddingModel && NO_EMBEDDING_KINDS.has(value.kind)) {
      ctx.addIssue({ code: 'custom', path: ['embeddingModel'], message: 'This provider does not offer embeddings' });
    }
    if (Boolean(value.awsAccessKeyId) !== Boolean(value.awsSecretAccessKey)) {
      ctx.addIssue({ code: 'custom', path: ['awsSecretAccessKey'], message: 'Enter both the access key ID and the secret access key' });
    }
    if (value.allowPrivateNetwork && value.isExternal) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowPrivateNetwork'],
        message: 'A private-network endpoint is not external; clear "external" or the private-network consent',
      });
    }
  });
export type AiProviderInput = z.infer<typeof aiProviderInputSchema>;
