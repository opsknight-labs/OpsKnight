// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import AgentSetupInstructions from '@/components/runbooks/AgentSetupInstructions';
import RunbookField from '@/components/runbooks/RunbookField';
import { Input } from '@/components/ui/shadcn/input';

afterEach(cleanup);
function setup() {
  return render(
    <AgentSetupInstructions
      token="single-use-fixture"
      executionPublicKey="public-key-fixture"
      appUrl="https://ops.example.com"
    />
  );
}
function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  return screen.getByRole('tabpanel').textContent!;
}
it('uses the installation URL and deploys only the Compose Agent', () => {
  setup();
  expect(screen.getByLabelText('OpsKnight URL from Agent')).toHaveValue('https://ops.example.com');
  const commands = screen.getByRole('tabpanel').textContent!;
  expect(commands).toContain('-p opsknight-agent -f deploy/compose/docker-compose.agent.yml');
  expect(commands).not.toContain('-f deploy/compose/docker-compose.yml');
});
it('Helm uses an Agent-only chart and honors the entered URL and digest', () => {
  setup();
  fireEvent.change(screen.getByLabelText('OpsKnight URL from Agent'), {
    target: { value: 'https://remote.example.com' },
  });
  fireEvent.change(screen.getByLabelText('Agent image'), {
    target: { value: 'registry.example.com:5000/agent@sha256:abcd' },
  });
  const commands = selectTab('Helm');
  expect(commands).toContain(
    'helm upgrade --install opsknight-agent deploy/kubernetes/helm/opsknight-agent'
  );
  expect(commands).toContain("--set-string agent.url='https://remote.example.com'");
  expect(commands).toContain("agent.image.digest='sha256:abcd'");
  expect(commands.indexOf('kubectl create namespace')).toBeLessThan(
    commands.indexOf('create secret generic')
  );
});
it('Kustomize honors URL and image without referencing application profiles', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Agent image'), {
    target: { value: 'registry.example.com:5000/agent:test' },
  });
  const commands = selectTab('Kustomize');
  expect(commands).toContain('"newName":"registry.example.com:5000/agent"');
  expect(commands).toContain('"newTag":"test"');
  const overlay = JSON.parse(commands.split("printf '%s' '")[1].split("' >")[0]);
  expect(JSON.parse(overlay.patches[0].patch)[0].value).toBe('https://ops.example.com');
  expect(commands).not.toContain('profiles/integrated');
});
it('Swarm references only the Agent stack', () => {
  setup();
  const commands = selectTab('Swarm');
  expect(commands).toContain('-c deploy/swarm/docker-stack.agent.yml opsknight-agent');
  expect(commands).not.toContain('docker-stack.integrated.yml');
});
it('associates generated field labels with their input', () => {
  render(
    <RunbookField label="Service unit">
      <Input name="service" />
    </RunbookField>
  );
  expect(screen.getByLabelText('Service unit')).toHaveAttribute('name', 'service');
});
