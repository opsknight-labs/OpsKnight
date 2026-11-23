/// <reference lib="webworker" />
// ELK runs here, off the main thread; the graph page loads this worker only when it lays out.
import ELK from 'elkjs/lib/elk.bundled.js';
import { runLayout, type LayoutRequest } from './layout';

const elk = new ELK();

self.onmessage = async (event: MessageEvent<{ id: number; request: LayoutRequest }>) => {
  const { id, request } = event.data;
  try {
    self.postMessage({ id, result: await runLayout(elk, request) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
