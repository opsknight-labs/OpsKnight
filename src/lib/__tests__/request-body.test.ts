import { describe, expect, it } from 'vitest';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/request-body';

describe('readJsonBodyWithLimit', () => {
  it('parses a JSON body within the byte limit', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: JSON.stringify({ value: 'ok' }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(readJsonBodyWithLimit(request, 1024)).resolves.toEqual({ value: 'ok' });
  });

  it('rejects a declared oversized body before parsing', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': '4097' },
    });

    await expect(readJsonBodyWithLimit(request, 4096)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });

  it('rejects chunked bodies that exceed the limit without Content-Length', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"value":"'));
        controller.enqueue(encoder.encode('x'.repeat(100)));
        controller.enqueue(encoder.encode('"}'));
        controller.close();
      },
    });
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: stream,
      // Required by Node/undici for streaming request bodies.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readJsonBodyWithLimit(request, 64)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });

  it('rejects malformed JSON', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      body: '{not-json}',
    });

    await expect(readJsonBodyWithLimit(request, 1024)).rejects.toBeInstanceOf(SyntaxError);
  });
});
