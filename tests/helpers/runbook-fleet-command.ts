import { spawn } from 'node:child_process';

/** Bound the complete fixture-owned process group, including Bash EXIT-trap children. */
export async function runFleetCommand(
  text: string,
  input: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 180_000
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bash', ['-c', text], {
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let expired = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* Owned process group already exited. */
      }
    };
    const timer = setTimeout(() => {
      expired = true;
      stop('SIGTERM');
      killTimer = setTimeout(() => stop('SIGKILL'), 1000);
      killTimer.unref();
    }, timeoutMs);
    const append = (data: Buffer) => {
      output = (output + data).slice(-8000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.stdin.on('error', () => {
      /* A failed command can close input before the token is read. */
    });
    child.stdin.end(input);
    child.on('error', error => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (code === 0 && !expired) resolve();
      else
        reject(
          new Error(
            `Generated fleet command ${expired ? 'timed out' : `failed (${code})`}: ${output}`
          )
        );
    });
  });
}
