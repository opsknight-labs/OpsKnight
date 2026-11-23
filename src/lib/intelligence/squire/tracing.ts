import { SpanStatusCode } from '@opentelemetry/api';
import { runWithDeadline, ToolDeadlineError } from '../ai/gateway';
import type { AiToolDefinition } from '../ai/port';
import { failSpan, startSpan, withSpan } from '../telemetry';
import type { SquireEvent } from './contract';

/** Tool names are code-defined, so already a closed set; anything else is reported as "other". */
const toolName = (name: string) => (/^[a-z][a-z0-9_]{0,63}$/.test(name) ? name : 'other');

/**
 * One Squire turn as a `squire.turn` span, read off the events it yields. Attributes are bounded
 * categories and counts only: never ids, questions or answers.
 */
export async function* traceTurn(
  turn: AsyncGenerator<SquireEvent>,
  signal?: AbortSignal
): AsyncGenerator<SquireEvent> {
  const span = startSpan('squire.turn', {});
  let mode: 'ai' | 'basic' | 'investigation' = 'basic';
  let outcome: 'completed' | 'error' | 'aborted' = 'aborted';
  let toolCalls = 0;
  let proposals = 0;
  let answered = false;
  try {
    for await (const event of turn) {
      if (event.type === 'meta' && mode !== 'investigation') mode = event.mode;
      else if (event.type === 'investigation') {
        mode = 'investigation';
        // Each step is sent when it starts and again when it ends; count its reads once.
        if (event.step.status === 'running') toolCalls += event.step.calls.length;
      } else if (event.type === 'tool') toolCalls += 1;
      else if (event.type === 'proposal') proposals += 1;
      else if (event.type === 'delta') answered = true;
      else if (event.type === 'error') outcome = 'error';
      else if (event.type === 'done' && outcome !== 'error') outcome = 'completed';
      yield event;
    }
  } catch (error) {
    outcome = 'error';
    failSpan(span, error);
    throw error;
  } finally {
    if (signal?.aborted) outcome = 'aborted';
    span.setAttribute('squire.mode', mode);
    span.setAttribute('squire.outcome', outcome);
    span.setAttribute('squire.tool_calls', toolCalls);
    span.setAttribute('squire.proposals', proposals);
    // Stopped after part of the answer was already shown.
    span.setAttribute('squire.interrupted', outcome === 'aborted' && answered);
    if (outcome === 'error') span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  }
}

/**
 * Runs a read tool inside a `squire.tool` span. The deadline is the gateway's own, applied here first so
 * a timeout is told apart from a failure; the gateway still turns it into its usual message.
 */
export function traceReadTool(tool: AiToolDefinition): AiToolDefinition {
  const execute = tool.execute;
  if (tool.kind !== 'READ' || !execute) return tool;
  return {
    ...tool,
    execute: (input, call) =>
      withSpan('squire.tool', { 'squire.tool': toolName(tool.name) }, async span => {
        try {
          // The tool gets a signal that aborts at the deadline, so a late result is discarded, not recorded.
          const result = await runWithDeadline(signal => execute(input, { signal }), call?.signal);
          const failed = !!result && typeof result === 'object' && 'error' in result;
          span.setAttribute('squire.tool.outcome', failed ? 'error' : 'ok');
          return result;
        } catch (error) {
          span.setAttribute(
            'squire.tool.outcome',
            error instanceof ToolDeadlineError ? 'timeout' : 'error'
          );
          throw error;
        }
      }),
  };
}
