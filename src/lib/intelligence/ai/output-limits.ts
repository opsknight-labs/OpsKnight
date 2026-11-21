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
  // A few sentences for a stakeholder update.
  'stakeholder.nudge': 250,
  'squire.context-summary': 400,
  'squire.classify': 64,
  'squire.plan': 600,
  'squire.diagnose': 1_200,
  // One plain-language sentence or two for each insight of one scope, in a single call.
  'insights.phrasing': 900,
  // Two sentences under an analytics card.
  'analytics.metric-change': 120,
  // Two sentences per team in the weekly digest.
  'digest.team-brief': 120,
  // On demand only: a few sentences on why a runbook step failed.
  'runbooks.failure-explain': 300,
  // One analytics filter object; a handful of short fields.
  'analytics.query': 120,
  // One paragraph on the reports page from the weekly digest facts.
  'reports.narrative': 220,
} as const;

export type AiFeature = keyof typeof AI_OUTPUT_TOKENS;

// eslint-disable-next-line security/detect-object-injection -- feature is a key of the closed table above
export const outputTokensFor = (feature: AiFeature): number => AI_OUTPUT_TOKENS[feature];
