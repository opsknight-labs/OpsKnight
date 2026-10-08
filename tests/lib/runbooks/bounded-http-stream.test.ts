import { describe, expect, it, vi } from 'vitest';
import { readBoundedResponseBody } from '@/lib/runbooks/orchestrator';

describe('readBoundedResponseBody streaming and memory bounds', () => {
  it('cancels the stream reader and limits output when response exceeds maxBytes', async () => {
    let cancelCalledWith: unknown = null;
    let chunksPushed = 0;

    // Create a large 5MB stream composed of 64KB chunks
    const chunkSize = 64 * 1024;
    const totalChunks = 80; // ~5.12 MB
    const chunkData = new Uint8Array(chunkSize).fill(65); // 'A'

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksPushed < totalChunks) {
          chunksPushed++;
          controller.enqueue(chunkData);
        } else {
          controller.close();
        }
      },
      cancel(reason) {
        cancelCalledWith = reason;
      },
    });

    const mockResponse = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });

    const maxBytes = 32 * 1024; // 32 KB limit
    const result = await readBoundedResponseBody(mockResponse, maxBytes);

    expect(result.length).toBe(maxBytes);
    expect(result).toBe('A'.repeat(maxBytes));
    expect(cancelCalledWith).toBe('HTTP response preview limit reached');
    // Only 1 chunk should have been pulled and then cancelled; not all 80 chunks!
    expect(chunksPushed).toBeLessThanOrEqual(2);
  });

  it('reads small responses fully without early cancellation', async () => {
    const smallText = 'Hello, OpsKnight Runbooks!';
    const response = new Response(smallText, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });

    const result = await readBoundedResponseBody(response, 1024);
    expect(result).toBe(smallText);
  });

  it('handles empty body cleanly', async () => {
    const response = new Response(null, { status: 204 });
    const result = await readBoundedResponseBody(response, 1024);
    expect(result).toBe('');
  });

  it('fallback fails closed when getReader is unavailable and Content-Length exceeds maxBytes', async () => {
    const fakeResponse = {
      body: {}, // No getReader function
      headers: new Headers({ 'content-length': '500000' }),
      text: vi.fn().mockResolvedValue('huge content'),
    } as unknown as Response;

    await expect(readBoundedResponseBody(fakeResponse, 1000)).rejects.toThrow(
      'Streaming response reader is unavailable and content size exceeds or cannot verify preview limit of 1000 bytes.'
    );
    expect(fakeResponse.text).not.toHaveBeenCalled();
  });

  it('fallback fails closed when getReader is unavailable and Content-Length header is missing', async () => {
    const fakeResponse = {
      body: {},
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('unknown size content'),
    } as unknown as Response;

    await expect(readBoundedResponseBody(fakeResponse, 1000)).rejects.toThrow(
      'Streaming response reader is unavailable and content size exceeds or cannot verify preview limit of 1000 bytes.'
    );
    expect(fakeResponse.text).not.toHaveBeenCalled();
  });

  it('fallback allows response when getReader is unavailable but trusted Content-Length is within maxBytes', async () => {
    const smallContent = '{"status":"ok"}';
    const fakeResponse = {
      body: {},
      headers: new Headers({ 'content-length': String(smallContent.length) }),
      text: vi.fn().mockResolvedValue(smallContent),
    } as unknown as Response;

    const result = await readBoundedResponseBody(fakeResponse, 1000);
    expect(result).toBe(smallContent);
    expect(fakeResponse.text).toHaveBeenCalled();
  });
});
