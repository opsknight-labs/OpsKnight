import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const BRIDGE_BIN = resolve(process.cwd(), 'sdk/mcp-bridge/bin/opsknight-mcp.js');

export type BridgeMessage = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

/** The bridge as a child process: write JSON-RPC lines, wait for stdout messages. */
export function startBridge(args: string[], env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [BRIDGE_BIN, ...args], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const received: BridgeMessage[] = [];
  let stdout = '';
  let stderr = '';
  let buffer = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      received.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>(done => child.on('exit', code => done(code)));
  return {
    child,
    received,
    exited,
    output: () => stdout + stderr,
    stderr: () => stderr,
    send: (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`),
    async waitFor(test: (message: BridgeMessage) => boolean, timeoutMs = 10_000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const found = received.find(test);
        if (found) return found;
        await new Promise(next => setTimeout(next, 20));
      }
      throw new Error(`no matching message; stderr: ${stderr}`);
    },
    async close() {
      child.stdin.end();
      return exited;
    },
  };
}
