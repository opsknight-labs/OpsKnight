/**
 * The one place that says how long each AI feature's answer may be. Callers pass `outputTokensFor(feature)`
 * instead of a literal; an architecture test rejects numeric `maxOutputTokens` anywhere else. The gateway
 * still clamps plain answers to the administrator's answer-length setting.
 */
export const AI_OUTPUT_TOKENS = {
  'incident.summary': 1_024,
  // A postmortem draft fills many fields; a summary is short.
  'postmortem.draft': 4_096,
  'handoff.narrative': 200,
  'squire.context-summary': 400,
  'squire.classify': 64,
  'squire.plan': 600,
  'squire.diagnose': 1_200,
} as const;

export type AiFeature = keyof typeof AI_OUTPUT_TOKENS;

// eslint-disable-next-line security/detect-object-injection -- feature is a key of the closed table above
export const outputTokensFor = (feature: AiFeature): number => AI_OUTPUT_TOKENS[feature];
