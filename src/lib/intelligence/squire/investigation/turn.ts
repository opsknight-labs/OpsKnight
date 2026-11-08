import 'server-only';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { capOutput } from '../../ai/gateway';
import {
  highestDataClass,
  resolveLanguageModel,
  type AiDataClass,
  type AiMessage,
  type AiRequestContext,
  type LanguageModelPort,
} from '../../ai/port';
import { redactSecrets } from '../../ai/redact';
import type { AiSettingsView } from '../../ai/settings';
import type { SquireEvent } from '../contract';
import type { SquireEvidenceRegistry } from '../evidence';
import { buildSquireTools, SQUIRE_TOOL_DATA_CLASS } from '../tools';
import { INVESTIGATION_LIMITS, runInvestigation } from './engine';

const CHUNK = 48;

/** The per-question token ceiling: the fixed cap, or a tenth of the daily budget when that is smaller. */
export function investigationCeiling(settings: Pick<AiSettingsView, 'dailyTokenBudget'>): number {
  return Math.max(
    8_000,
    Math.min(INVESTIGATION_LIMITS.tokenCeiling, Math.floor(settings.dailyTokenBudget / 10))
  );
}

/** A routed port for the capability, or the conversation's own port when no route resolves. */
export async function portFor(
  capability: 'CLASSIFY' | 'DIAGNOSE',
  dataClass: AiDataClass,
  fallback: LanguageModelPort
): Promise<LanguageModelPort> {
  return (await resolveLanguageModel(capability, dataClass)) ?? fallback;
}

/**
 * One investigation turn on the chat stream: step events while it works, then the answer, citations,
 * suggestions and the saved-turn metadata, exactly like an ordinary AI answer. `finish` supplies the
 * read-only context proofs the chat module mints for every answer. If the planner fails before anything is
 * read, `fallback` produces the ordinary basic answer instead.
 */
export async function* streamInvestigation(input: {
  actor: AuthorizationActor;
  question: string;
  preamble: AiMessage[];
  context: Omit<AiRequestContext, 'capability'>;
  dataClass: AiDataClass;
  chatPort: LanguageModelPort;
  settings: Pick<AiSettingsView, 'dailyTokenBudget'>;
  evidence: SquireEvidenceRegistry;
  labels: Readonly<Record<string, string>>;
  suggestions: string[];
  verifiedHash: string;
  finish: (answer: string) => Promise<SquireEvent>;
  fallback: () => AsyncGenerator<SquireEvent>;
}): AsyncGenerator<SquireEvent> {
  const ranClasses: AiDataClass[] = [];
  const tools = buildSquireTools(input.actor, {
    personal: true,
    dataClass: input.dataClass,
    signal: input.context.signal,
    observe: (name, toolInput, result) => {
      // eslint-disable-next-line security/detect-object-injection -- lookup in a fixed table; unknown names fall back
      ranClasses.push(SQUIRE_TOOL_DATA_CLASS[name] ?? 'INTERNAL');
      return input.evidence.observe(name, toolInput, result);
    },
  }).filter(tool => tool.kind === 'READ');
  const [planner, diagnoser] = await Promise.all([
    portFor('CLASSIFY', input.dataClass, input.chatPort),
    portFor('DIAGNOSE', input.dataClass, input.chatPort),
  ]);
  const run = runInvestigation({
    question: input.question,
    preamble: input.preamble,
    context: input.context,
    dataClass: input.dataClass,
    planner,
    diagnoser,
    tools,
    labels: input.labels,
    ledger: input.evidence,
    envelope: capOutput,
    tokenCeiling: investigationCeiling(input.settings),
  });
  let outcome;
  const shown = new Set<string>();
  try {
    for (;;) {
      const next = await run.next();
      if (next.done) {
        outcome = next.value;
        break;
      }
      for (const text of input.evidence.notices())
        if (!shown.has(text)) {
          shown.add(text);
          yield { type: 'notice', text };
        }
      yield next.value;
    }
  } catch {
    // Nothing was read and the planner is unavailable: answer the ordinary way.
    yield { type: 'notice', text: 'AI is unavailable right now. Showing a basic answer.' };
    yield* input.fallback();
    return;
  }
  const answer = redactSecrets(outcome.answer);
  if (outcome.partial)
    yield {
      type: 'notice',
      text: 'The investigation stopped early. This is a partial answer built from what was read.',
    };
  for (let i = 0; i < answer.length; i += CHUNK)
    yield { type: 'delta', text: answer.slice(i, i + CHUNK) };
  const citations = input.evidence.citations(answer);
  if (citations.length > 0) yield { type: 'citations', items: citations };
  yield { type: 'suggestions', items: input.suggestions };
  yield {
    type: 'memory',
    turn: {
      mode: 'ai',
      dataClass: highestDataClass([input.dataClass, ...ranClasses]),
      completion: 'COMPLETED',
      sources: input.evidence.sources(),
      verified: input.evidence.verified,
      authorizationHash: input.verifiedHash,
      ...(outcome.partial ? { notices: ['Partial investigation answer.'] } : {}),
    },
  };
  yield await input.finish(answer);
  yield { type: 'done' };
}
