import { z } from 'zod/v4';
import type { AiDataClass, AiRequestContext, LanguageModelPort } from '../../ai/port';

/** Asking for an investigation outright, or for a cause. */
const EXPLICIT =
  /\b(?:investigat\w*|root[- ]?cause|rca|diagnos\w*|troubleshoot\w*|debug\w*|why (?:is|are|did|does|do|was|were|has|have)|what (?:caused|is causing|broke|went wrong)|cause of|figure out why)\b/i;
/** Symptom words that may or may not want a full investigation; a cheap classifier decides. */
const SYMPTOM =
  /\b(?:slow|failing|fails|failed|errors?|5\d\d|latency|timeouts?|timing out|down|outage|spik\w*|degrad\w*|crash\w*|unhealthy|broken|flapping|related|correlat\w*)\b/i;
/** Requests for a single fact or an action are never investigations. */
const NOT_DIAGNOSTIC =
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored, fixed alternatives with no nested quantifiers
  /^\s*(?:\/\w+|(?:please\s+)?(?:ack(?:nowledge)?|resolve|snooze|reassign|assign|escalate|add (?:a )?note|who(?:'s| is) on[- ]?call|list|show me the (?:alerts|timeline)|hi|hello|thanks?|help)\b)/i;

export type DiagnosticCue = 'yes' | 'maybe' | 'no';

/** Deterministic first pass: no model is called for a clear yes or a clear no. */
export function diagnosticCue(message: string): DiagnosticCue {
  if (NOT_DIAGNOSTIC.test(message)) return 'no';
  if (EXPLICIT.test(message)) return 'yes';
  if (SYMPTOM.test(message) && /\?|\b(?:is|are|could|might|why|what|how)\b/i.test(message))
    return 'maybe';
  return 'no';
}

const verdictSchema = z.object({ investigate: z.boolean() }).strict();

/**
 * Whether a question should run as an investigation. Clear cases are decided by pattern; an ambiguous
 * symptom question asks the CLASSIFY route (a cheap model) for a yes/no. Any classifier failure means no.
 */
export async function wantsInvestigation(
  message: string,
  options: {
    onIncident: boolean;
    /** Resolved only when a model is actually needed (an ambiguous question on an incident). */
    classifier: () => Promise<LanguageModelPort | null>;
    context: Omit<AiRequestContext, 'capability'>;
    dataClass: AiDataClass;
  }
): Promise<boolean> {
  const cue = diagnosticCue(message);
  if (cue !== 'maybe') return cue === 'yes';
  // Without an incident in view, a vague symptom question is usually a search, not an investigation.
  if (!options.onIncident) return false;
  try {
    const classifier = await options.classifier();
    if (!classifier) return false;
    const result = await classifier.generateStructured({
      context: { ...options.context, capability: 'CLASSIFY' },
      messages: [
        {
          role: 'system',
          content:
            'Decide whether the user is asking to diagnose the cause of a problem (true) or for a single fact, list or action (false). Reply with {"investigate": boolean}.',
          dataClass: options.dataClass,
        },
        { role: 'user', content: message.slice(0, 600), dataClass: options.dataClass },
      ],
      schema: verdictSchema,
      schemaName: 'investigation_intent',
      maxOutputTokens: 64,
    });
    return result.object.investigate;
  } catch {
    return false;
  }
}
