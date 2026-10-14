// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentDistribution } from '@/lib/runbooks/distribution-contract';
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

it('blocks copyable native installation when release assets are not verified', () => {
  setup();
  selectTab('Linux');
  expect(screen.queryByText(/releases\/download\/v2.0.0\/install.sh/)).not.toBeInTheDocument();
  expect(screen.getByText(/No verified Agent release/)).toBeVisible();
});
it('does not copy commands for a loopback Agent endpoint', () => {
  setup();
  fireEvent.change(screen.getByLabelText('OpsKnight URL from Agent'), {
    target: { value: 'http://localhost:3000' },
  });
  expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
});
it('allows only the verified digest after endpoint confirmation and disables copying at expiry', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  const distribution: AgentDistribution = {
    checkedAt: new Date().toISOString(),
    installerUrl: 'https://github.com/opsknight-labs/OpsKnight/releases/download/v2.1.0/install.sh',
    manifest: {
      schemaVersion: 1,
      version: '2.1.0',
      revision: 'a'.repeat(40),
      protocolVersions: [1],
      policySchemaVersion: 1,
      server: { minimum: '2.1.0', maximumExclusive: '2.1.1' },
      image: {
        reference: `ghcr.io/opsknight-labs/opsknight-agent@sha256:${'b'.repeat(64)}`,
        architectures: ['linux/amd64', 'linux/arm64'],
      },
      installer: { filename: 'install.sh', sha256: 'c'.repeat(64) },
    },
  };
  render(
    <AgentSetupInstructions
      token="one-time-secret-value"
      executionPublicKey="public-pin"
      appUrl="https://ops.company.internal"
      distribution={distribution}
      expiresAt="2026-10-14T12:00:02Z"
    />
  );
  expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText('I confirmed this URL is reachable from the Agent host or cluster.')
  );
  expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('one-time-secret-value');
  fireEvent.change(screen.getByLabelText('Agent image'), {
    target: { value: 'unverified:latest' },
  });
  expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Agent image'), {
    target: { value: distribution.manifest.image.reference },
  });
  expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  expect(screen.getByText(/Enrollment token expired/)).toBeVisible();
});
