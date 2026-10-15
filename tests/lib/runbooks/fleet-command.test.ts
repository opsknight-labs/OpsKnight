// @vitest-environment node
import { expect, it } from 'vitest';
import { runFleetCommand } from '../../helpers/runbook-fleet-command';
it('terminates a stuck child and Bash cleanup trap within the command deadline', async () => {
  const started = performance.now();
  await expect(
    runFleetCommand("trap 'sleep 30' EXIT\nsleep 30", '', process.env, 100)
  ).rejects.toThrow('timed out');
  expect(performance.now() - started).toBeLessThan(3000);
});
it('accepts a completed generated command without printing its input', async () => {
  await expect(
    runFleetCommand(
      'read -r token\n[ "$token" = \'fixture-token\' ]',
      'fixture-token\n',
      process.env,
      1000
    )
  ).resolves.toBeUndefined();
});
