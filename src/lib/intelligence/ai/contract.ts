import { z } from 'zod/v4';
import { AI_DATA_CLASSES } from './port';

export const SQUIRE_AVATARS = ['ICON', 'KNIGHT', 'OWL', 'ROBOT'] as const;
export type SquireAvatar = (typeof SQUIRE_AVATARS)[number];
export const SQUIRE_LAUNCHERS = ['FLOATING', 'SEARCH_ONLY'] as const;
export type SquireLauncherStyle = (typeof SQUIRE_LAUNCHERS)[number];

export const AI_PROVIDER_KINDS = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENAI_COMPATIBLE'] as const;
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
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'OPENAI_COMPATIBLE' && !value.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'A base URL is required for OpenAI-compatible endpoints' });
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
