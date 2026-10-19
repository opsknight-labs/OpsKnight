import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';
const chart = 'deploy/kubernetes/helm/opsknight';
function render(split, upgrade = true) {
  const args = ['template', 'sso', chart, '--set', 'image.tag=2.1.0'];
  if (upgrade) args.push('--is-upgrade');
  if (split)
    args.push(
      '--set',
      'runtime.mode=split',
      '--set',
      'scheduler.profile=maintenance',
      '--set',
      'image.tag=2.1.0'
    );
  return parseAllDocuments(execFileSync('helm', args, { encoding: 'utf8' }))
    .map(doc => doc.toJSON())
    .filter(Boolean);
}
for (const split of [false, true])
  test(`${split ? 'split' : 'integrated'} cutover stops incompatible overlap before migrations`, () => {
    const docs = render(split);
    const workloads = docs.filter(
      doc =>
        doc.kind === 'Deployment' &&
        doc.metadata.name.startsWith('sso-opsknight') &&
        !doc.metadata.name.endsWith('pgbouncer')
    );
    assert.equal(workloads.length, split ? 7 : 1);
    for (const workload of workloads)
      assert.deepEqual(workload.spec.strategy, { type: 'Recreate' });
    const gate = docs.find(doc => doc.kind === 'Job' && doc.metadata.name.endsWith('auth-cutover'));
    const migration = docs.find(
      doc => doc.kind === 'Job' && doc.metadata.name.endsWith('migration')
    );
    assert.equal(gate.metadata.annotations['helm.sh/hook'], 'pre-upgrade');
    assert.ok(
      Number(gate.metadata.annotations['helm.sh/hook-weight']) <
        Number(migration.metadata.annotations['helm.sh/hook-weight'])
    );
    assert.equal(gate.spec.backoffLimit, 0);
    const role = docs.find(
      doc => doc.kind === 'Role' && doc.metadata.name.endsWith('auth-cutover')
    );
    assert.deepEqual(
      role.rules.map(rule => rule.verbs),
      [['get'], ['list'], ['list']]
    );
    assert.equal(role.rules[0].resourceNames.length, 8);
    const pod = gate.spec.template.spec;
    assert.equal(pod.automountServiceAccountToken, true);
    assert.equal(pod.containers[0].image, workloads[0].spec.template.spec.containers[0].image);
    assert.equal(
      docs.filter(doc => doc.kind === 'RoleBinding' && doc.metadata.name === role.metadata.name)
        .length,
      1
    );
  });
test('fresh installations do not require an existing runtime cutover', () => {
  assert.equal(
    render(false, false).some(doc => doc.metadata?.name?.endsWith('auth-cutover')),
    false
  );
});

test('upgrades refuse the implicit old chart appVersion image', () => {
  assert.throws(
    () =>
      execFileSync('helm', ['template', 'sso', chart, '--is-upgrade'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    /explicit tested image/
  );
});
