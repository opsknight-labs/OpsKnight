import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A minimal OpenAI-compatible chat-completions server for exercising the real AI SDK end to end. */
type Scripted = { status?: number; content?: string; toolCall?: { name: string; args: string }; usage?: [number, number] };

export interface FakeServer {
  url: string;
  requests: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }>;
  script: Scripted[];
  /** Vector returned for each input on /embeddings; defaults to a hashed bag of words. */
  embed: (text: string) => number[];
  close: () => Promise<void>;
}

/** Deterministic 16-dimension bag-of-words vector: texts sharing words point the same way. */
export function bagOfWordsVector(text: string): number[] {
  const vector = new Array<number>(16).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) % 16;
    vector.splice(hash, 1, (vector.at(hash) ?? 0) + 1);
  }
  return vector;
}

export async function startFakeModel(): Promise<FakeServer> {
  const state: FakeServer = { url: '', requests: [], script: [], embed: bagOfWordsVector, close: async () => undefined };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      state.requests.push({ path: req.url ?? '', auth: req.headers.authorization, body });
      if ((req.url ?? '').endsWith('/embeddings')) {
        const failure = state.script[0]?.status && state.script[0].status >= 400 ? state.script.shift() : undefined;
        if (failure) {
          res.writeHead(failure.status ?? 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'upstream failure' } }));
          return;
        }
        const inputs = Array.isArray(body.input) ? (body.input as string[]) : [String(body.input)];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: inputs.map((input, index) => ({ object: 'embedding', index, embedding: state.embed(input) })),
            model: String(body.model),
            usage: { prompt_tokens: inputs.length * 3, total_tokens: inputs.length * 3 },
          })
        );
        return;
      }
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

