import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A minimal OpenAI-compatible chat-completions server for exercising the real AI SDK end to end. */
type Scripted = { status?: number; content?: string; toolCall?: { name: string; args: string }; usage?: [number, number] };

export interface FakeServer {
  url: string;
  requests: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }>;
  script: Scripted[];
  close: () => Promise<void>;
}

export async function startFakeModel(): Promise<FakeServer> {
  const state: FakeServer = { url: '', requests: [], script: [], close: async () => undefined };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      state.requests.push({ path: req.url ?? '', auth: req.headers.authorization, body });
      const next = state.script.shift() ?? { content: 'ok' };
      if (next.status && next.status >= 400) {
        res.writeHead(next.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream failure' } }));
        return;
      }
      const [promptTokens, completionTokens] = next.usage ?? [11, 7];
      const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
      const message = next.toolCall
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: next.toolCall.name, arguments: next.toolCall.args } }] }
        : { role: 'assistant', content: next.content ?? '' };
      const finish = next.toolCall ? 'tool_calls' : 'stop';
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta: unknown, finishReason: string | null = null) =>
          `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
        res.write(chunk({ role: 'assistant', content: '' }));
        if (next.toolCall) {
          res.write(
            chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: next.toolCall.name, arguments: next.toolCall.args } }] })
          );
          res.write(chunk({}, 'tool_calls'));
        } else {
          const words = (next.content ?? '').split(' ');
          words.forEach((word, i) => res.write(chunk({ content: i === 0 ? word : ` ${word}` })));
          res.write(chunk({}, 'stop'));
        }
        res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message, finish_reason: finish }], usage }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  state.close = () => new Promise(resolve => server.close(() => resolve()));
  return state;
}

