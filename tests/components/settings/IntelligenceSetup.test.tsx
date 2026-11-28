import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { OPS_INSIGHT_SWITCHES } from '@/lib/intelligence/ops-insights/contract';
import type { NoiseReadiness } from '@/lib/intelligence/noise-controls/manage';
import type { SetupState } from '@/lib/intelligence/settings/setup-contract';

vi.mock('@/app/(app)/settings/intelligence/setup-actions', () => {
  const action = vi.fn(async () => ({ message: '', ok: true }));
  return {
    applyRecommendedSetup: action,
    switchOnIntelligence: action,
    addAiModelAction: action,
  };
});
const { default: IntelligenceSetupGuide } =
  await import('@/components/settings/IntelligenceSetupGuide');
const { default: IntelligenceSetupChecklist } =
  await import('@/components/settings/IntelligenceSetupChecklist');

const insights = (on: boolean) =>
  Object.fromEntries(OPS_INSIGHT_SWITCHES.map(key => [key, on])) as Record<
    (typeof OPS_INSIGHT_SWITCHES)[number],
    boolean
  >;
const fresh: SetupState = {
  settings: { enabled: false, revision: 1, opsHelpersEnabled: false, ...insights(false) },
  policy: { version: 1, mode: 'OFF', triageEnabled: false },
  noise: { revision: 1, mode: 'OFF', detectorsOn: false },
  squireEnabled: true,
  aiConfigured: false,
};
const watching: SetupState = {
  ...fresh,
  settings: { enabled: true, revision: 2, opsHelpersEnabled: true, ...insights(true) },
  policy: { version: 2, mode: 'SHADOW', triageEnabled: true },
  noise: { revision: 2, mode: 'SHADOW', detectorsOn: true },
};
const showing: SetupState = {
  ...watching,
  policy: { version: 3, mode: 'SUGGEST', triageEnabled: true },
};
const acting: SetupState = { ...showing, noise: { revision: 3, mode: 'ON', detectorsOn: true } };
const evidence = (shadowDecisions: number): NoiseReadiness => ({
  ready: shadowDecisions >= 50,
  shadowDecisions,
  reversed: 0,
  falsePositiveRate: 0,
  windowDays: 7,
  minimumShadowDecisions: 50,
  maxFalsePositiveRate: 0.02,
});
const none = { services: 0, integrations: 0, incidents: 0 };

describe('IntelligenceSetupGuide', () => {
  it('opens on Start watching for a fresh install, with the plain promise and one button', () => {
    const { container } = render(<IntelligenceSetupGuide state={fresh} counts={none} canManage />);
    expect(screen.getByRole('list', { name: 'Setup steps' }).querySelectorAll('li')).toHaveLength(
      4
    );
    expect(screen.getByRole('heading', { name: 'Start watching' })).toBeInTheDocument();
    expect(screen.getByText(/Nobody.s paging changes/)).toBeInTheDocument();
    // The step list also has a "Start watching" button; the action is the submit button in the form.
    expect(container.querySelector('form button[type="submit"]')).toHaveTextContent(
      'Start watching'
    );
  });

  it('shows no change buttons to someone who cannot manage, and says why', () => {
    const { container } = render(
      <IntelligenceSetupGuide state={fresh} counts={none} canManage={false} />
    );
    expect(screen.getByRole('note')).toHaveTextContent(/only an administrator/);
    expect(container.querySelector('form')).toBeNull();
  });

  it('moves on to the first step that is not done, and marks finished steps', () => {
    render(<IntelligenceSetupGuide state={watching} counts={none} canManage />);
    expect(screen.getByRole('heading', { name: 'Connect your alerts' })).toBeInTheDocument();
    expect(screen.getByText(/No services yet/)).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Setup steps' });
    expect(within(steps).getByRole('button', { name: /Start watching/ })).toHaveTextContent(
      '(done)'
    );
    expect(screen.getByRole('link', { name: 'Add a service or integration' })).toHaveAttribute(
      'href',
      '/services'
    );
  });

  it('says what it is learning from once alerts are connected', () => {
    render(
      <IntelligenceSetupGuide
        state={watching}
        counts={{ services: 3, integrations: 2, incidents: 1204 }}
        canManage
      />
    );
    // Alerts are done, so the guide opens on the AI model step.
    expect(screen.getByRole('heading', { name: 'Add an AI model' })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /Connect your alerts/,
      })
    );
    expect(screen.getByText('Learning from 3 services and 1,204 incidents.')).toBeInTheDocument();
  });

  it('offers the AI model as optional, with a safe skip and the choice of what it may read', () => {
    const { container } = render(
      <IntelligenceSetupGuide
        state={watching}
        counts={{ services: 1, integrations: 1, incidents: 5 }}
        canManage
      />
    );
    expect(screen.getByText(/Optional\. Squire already answers/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    const sent = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(sent.get('kind')).toBe('ANTHROPIC');
    expect(sent.get('incidentText')).toBe('text');
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('radio', { name: /OpenAI/ }));
    expect(new FormData(container.querySelector('form') as HTMLFormElement).get('kind')).toBe(
      'OPENAI'
    );
    fireEvent.click(screen.getByRole('radio', { name: /Titles and service names only/ }));
    expect(
      new FormData(container.querySelector('form') as HTMLFormElement).get('incidentText')
    ).toBe('titles');
  });

  it('ends with what happens next and a link to the overview', () => {
    render(<IntelligenceSetupGuide state={watching} counts={none} canManage />);
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Setup steps' })).getByRole('button', {
        name: /You.re set/,
      })
    );
    expect(screen.getByText(/Check back in about a week/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Intelligence' })).toHaveAttribute(
      'href',
      '/intelligence'
    );
  });
});

describe('IntelligenceSetupChecklist (setup status)', () => {
  it('is off: a manager gets Get started, others are told to ask', () => {
    const { rerender } = render(
      <IntelligenceSetupChecklist state={fresh} canManage readiness={evidence(0)} />
    );
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/settings/intelligence/setup'
    );
    rerender(
      <IntelligenceSetupChecklist state={fresh} canManage={false} readiness={evidence(0)} />
    );
    expect(screen.queryByRole('link', { name: 'Get started' })).not.toBeInTheDocument();
    expect(screen.getByText('Ask an administrator to turn it on.')).toBeInTheDocument();
  });

  it('is learning without enough evidence: shows progress and only offers suggestions', () => {
    render(<IntelligenceSetupChecklist state={watching} canManage readiness={evidence(34)} />);
    expect(screen.getByText(/34 of 50/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Watching evidence' })).toHaveAttribute(
      'aria-valuenow',
      '34'
    );
    expect(screen.getByRole('button', { name: 'Show suggestions to my team' })).toBeInTheDocument();
    expect(screen.getByText(/Showing suggestions never changes who is paged/)).toBeInTheDocument();
  });

  it('is learning with enough evidence: one button for suggestions and noise controls', () => {
    render(<IntelligenceSetupChecklist state={watching} canManage readiness={evidence(64)} />);
    expect(
      screen.getByRole('button', { name: 'Show suggestions and turn noise controls on' })
    ).toBeInTheDocument();
  });

  it('is showing: noise controls are the only step left, and only with evidence', () => {
    const { rerender } = render(
      <IntelligenceSetupChecklist state={showing} canManage readiness={evidence(10)} />
    );
    expect(
      screen.queryByRole('button', { name: /Turn noise controls on/ })
    ).not.toBeInTheDocument();
    rerender(<IntelligenceSetupChecklist state={showing} canManage readiness={evidence(60)} />);
    expect(screen.getByRole('button', { name: 'Turn noise controls on' })).toBeInTheDocument();
  });

  it('shows no change buttons to someone who cannot manage', () => {
    render(
      <IntelligenceSetupChecklist state={watching} canManage={false} readiness={evidence(64)} />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Watched/)).toBeInTheDocument();
  });

  it('stays on screen when everything is on, with the stage and what is on', () => {
    render(<IntelligenceSetupChecklist state={acting} canManage readiness={evidence(80)} />);
    expect(screen.getByText(/High-urgency alerts always page/)).toBeInTheDocument();
    const stages = screen.getByRole('list', { name: 'Where Intelligence is' });
    expect(within(stages).getByText('Acting').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(screen.getByRole('list', { name: 'Intelligence setup' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Switch|Show suggestions|Turn noise/ })
    ).not.toBeInTheDocument();
  });

  it('lists the AI row as off until a model exists, even though Squire is on', () => {
    render(<IntelligenceSetupChecklist state={watching} canManage readiness={evidence(5)} />);
    const row = document.querySelector('[data-setup-item="assistant"]') as HTMLElement;
    expect(row).toHaveTextContent('(off)');
  });
});
