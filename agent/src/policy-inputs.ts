/** Unknown action configurations remain conservative. Bash policy compares only the exact command.
 * Secrets passed through OPSKNIGHT_INPUT_* at execution never become shell source text here. */
export function hasUnverifiablePolicyInput(step: { type?: string; config: unknown }): boolean {
  if (step.type === 'BASH' && step.config && typeof step.config === 'object') {
    const command = (step.config as Record<string, unknown>).command;
    return JSON.stringify(command)?.includes('[REDACTED]') ?? false;
  }
  return JSON.stringify(step.config)?.includes('[REDACTED]') ?? false;
}
