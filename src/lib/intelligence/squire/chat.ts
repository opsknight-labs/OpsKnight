import 'server-only';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { registerAiGateway } from '../ai/gateway';
import { resolveLanguageModel, type AiMessage } from '../ai/port';
import { getAiSettings } from '../ai/settings';
import { getGuidance } from '../ai/prompts';
import { SQUIRE_LIMITS, type SquireEvent, type SquireRequest } from './contract';
import { answerDeterministically, readIncidentForActor } from './deterministic';
import { buildSystemPrompt } from './prompt';
import { buildSquireTools } from './tools';

const CHUNK = 48;

async function* typed(text: string): AsyncGenerator<SquireEvent> {
  for (let i = 0; i < text.length; i += CHUNK) yield { type: 'delta', text: text.slice(i, i + CHUNK) };
}

/**
 * One Squire turn as a stream of events. It never throws: any failure becomes an `error` or a
 * graceful fall back to the basic (no-AI) answer, so a model outage degrades the assistant rather than
 * breaking it. Unreadable or unknown incident ids are dropped silently so they cannot be probed.
 */
export async function* streamSquire(
  actor: AuthorizationActor,
  request: SquireRequest,
  signal?: AbortSignal
): AsyncGenerator<SquireEvent> {
  try {
    const settings = await getAiSettings();
    if (!settings.squireEnabled) {
      yield { type: 'error', message: 'The assistant is turned off.' };
      return;
    }
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) {
      yield { type: 'error', message: 'You do not have access to the assistant.' };
      return;
    }
    const incident = request.incidentId ? await readIncidentForActor(actor, request.incidentId) : null;

    registerAiGateway();
    const port = settings.enabled ? await resolveLanguageModel('SQUIRE_CHAT', 'INTERNAL') : null;

    if (port) {
      yield { type: 'meta', mode: 'ai', name: settings.squireName };
      const prompt = buildSystemPrompt(settings.squireName, incident, await getGuidance('squire.system'));
      const messages: AiMessage[] = [
        { role: 'system', content: prompt.system },
        ...request.history.slice(-SQUIRE_LIMITS.historyMax).map(turn => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: request.message },
      ];
      let emitted = false;
      for await (const event of port.stream({
        context: { actorId: actor.id, capability: 'SQUIRE_CHAT', dataClass: 'INTERNAL', incidentId: incident?.id, signal, prompt: prompt.meta },
        messages,
        tools: buildSquireTools(actor),
        maxSteps: SQUIRE_LIMITS.maxSteps,
      })) {
        if (event.type === 'text-delta') {
          emitted = true;
          yield { type: 'delta', text: event.delta };
        } else if (event.type === 'error') {
          if (emitted) {
            yield { type: 'error', message: event.message };
            return;
          }
          // Nothing shown yet: answer from the intelligence data instead.
          yield {
            type: 'notice',
            text: event.retryable && /Too many|budget/i.test(event.message) ? `${event.message}. Showing a basic answer.` : 'AI is unavailable right now. Showing a basic answer.',
          };
          yield { type: 'meta', mode: 'basic', name: settings.squireName };
          yield* typed(await answerDeterministically(actor, request.message, incident));
          yield { type: 'done' };
          return;
        }
      }
      yield { type: 'done' };
      return;
    }

    yield { type: 'meta', mode: 'basic', name: settings.squireName };
    yield* typed(await answerDeterministically(actor, request.message, incident));
    yield { type: 'done' };
  } catch (error) {
    if (signal?.aborted) return;
    logger.error('[Squire] Turn failed', { error: error instanceof Error ? error.message : String(error) });
    yield { type: 'error', message: 'Something went wrong. Please try again.' };
  }
}
