export function kubernetesRecoveryTargets(mode = 'split') {
  const scope = 'app.kubernetes.io/instance=automation';
  if (mode === 'integrated') {
    return [{ role: 'integrated', selector: `${scope},app.kubernetes.io/name=opsknight` }];
  }
  if (mode !== 'split') throw new Error(`Unsupported recovery runtime mode: ${mode}`);
  return ['web', 'critical', 'general'].map(role => ({
    role,
    selector: `${scope},app.kubernetes.io/component=${role === 'web' ? role : `${role}-worker`}`,
  }));
}

export function requireRecoveryTarget(value: string, role: string): string {
  const target = value.trim();
  if (!target) throw new Error(`Recovery drill could not find a ${role} replica`);
  return target;
}
