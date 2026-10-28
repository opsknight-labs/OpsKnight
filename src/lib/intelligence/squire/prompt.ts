import { renderPrompt, type RenderedPrompt } from '../ai/prompts';
import type { ReadableIncident } from './deterministic';

/**
 * The assistant's system prompt, from the prompt registry. It states the assistant's limits and, most
 * importantly, that anything arriving through tools or quoted in the conversation is data to read, never
 * instructions to follow. The prompt is defence in depth: authority never rests on it, because tools run
 * under the user's own permissions and there are no write tools.
 */
export function buildSystemPrompt(
  name: string,
  incident: ReadableIncident | null,
  guidance: { text: string; revision: number } | null = null
): RenderedPrompt {
  const context = incident
    ? [`The user is viewing incident ${incident.id} (service ${incident.serviceName}, status ${incident.status.toLowerCase()}). Use get_intelligence with that id when relevant.`]
    : [];
  return renderPrompt('squire.system', { name }, guidance, context);
}
