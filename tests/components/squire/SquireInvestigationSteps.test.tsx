import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SquireInvestigationSteps from '@/components/squire/SquireInvestigationSteps';
import { mergeInvestigationStep, type InvestigationStepView } from '@/components/squire/chat-types';

const steps: InvestigationStepView[] = [
  {
    index: 1,
    title: 'Check the alert and recent changes',
    status: 'done',
    calls: [
      { tool: 'get_alert_payload', label: 'Reading the alert payload', ok: true },
      { tool: 'get_recent_changes', label: 'Checking recent changes', ok: false },
    ],
  },
  { index: 2, title: 'Weighing the evidence', status: 'running', calls: [] },
];

describe('Squire investigation steps', () => {
  it('is open while streaming and folds away when the answer is complete', () => {
    const { container, rerender } = render(
      <SquireInvestigationSteps steps={steps} streaming={true} />
    );
    const outer = container.querySelector('[data-testid="squire-investigation"]')!;
    expect(outer).toHaveAttribute('open');
    expect(screen.getByText(/Investigation · 2 steps · 2 reads/)).toBeInTheDocument();
    rerender(<SquireInvestigationSteps steps={steps} streaming={false} />);
    expect(outer).not.toHaveAttribute('open');
  });

  it('expands a step to show the reads it ran, marking failed ones', () => {
    const { container } = render(<SquireInvestigationSteps steps={steps} streaming={false} />);
    const step = screen.getByLabelText('Step 1: Check the alert and recent changes (done)');
    const details = step.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(step);
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Reading the alert payload')).toBeInTheDocument();
    expect(
      screen.getByText(/Checking recent changes — failed or not permitted/)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Step 2: Weighing the evidence (in progress)')
    ).toBeInTheDocument();
    expect(container.querySelector('a, button')).toBeNull();
  });

  it('is operable from the keyboard: every disclosure is a focusable summary with a visible focus ring', () => {
    const { container } = render(<SquireInvestigationSteps steps={steps} streaming={true} />);
    const summaries = Array.from(container.querySelectorAll('summary'));
    expect(summaries).toHaveLength(3);
    for (const summary of summaries) {
      // A summary is natively focusable and toggled by Enter/Space; nothing may take it out of the order.
      expect(summary).not.toHaveAttribute('tabindex', '-1');
      expect(summary.className).toContain('focus-visible:ring-2');
      summary.focus();
      expect(summary).toHaveFocus();
    }
    expect(screen.getByRole('list', { name: 'Investigation steps' })).toBeInTheDocument();
  });

  it('moves focus to the heading when the list folds away under the keyboard', () => {
    const { container, rerender } = render(
      <SquireInvestigationSteps steps={steps} streaming={true} />
    );
    const outer = container.querySelector<HTMLDetailsElement>(
      '[data-testid="squire-investigation"]'
    )!;
    const heading = outer.querySelector<HTMLElement>(':scope > summary')!;
    const step = screen.getByLabelText('Step 1: Check the alert and recent changes (done)');
    step.focus();
    rerender(<SquireInvestigationSteps steps={steps} streaming={false} />);
    expect(outer).not.toHaveAttribute('open');
    expect(heading).toHaveFocus();
  });

  it('leaves focus alone when it is outside the list as it folds away', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const { rerender } = render(<SquireInvestigationSteps steps={steps} streaming={true} />);
    outside.focus();
    rerender(<SquireInvestigationSteps steps={steps} streaming={false} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('renders nothing without steps', () => {
    const { container } = render(<SquireInvestigationSteps steps={[]} streaming={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('investigation step merging', () => {
  it('replaces a step by index, keeps order and ignores malformed events', () => {
    let current = mergeInvestigationStep(undefined, {
      index: 2,
      title: 'second',
      status: 'running',
      calls: [],
    });
    current = mergeInvestigationStep(current, {
      index: 1,
      title: 'first',
      status: 'running',
      calls: [{ tool: 't', label: 'L' }],
    });
    current = mergeInvestigationStep(current, {
      index: 1,
      title: 'first',
      status: 'done',
      calls: [{ tool: 't', label: 'L', ok: true }, { tool: 1 }],
    });
    expect(current?.map(step => `${step.index}:${step.status}`)).toEqual(['1:done', '2:running']);
    expect(current?.[0].calls).toEqual([{ tool: 't', label: 'L', ok: true }]);
    expect(mergeInvestigationStep(current, { index: 'x' })).toBe(current);
    expect(
      mergeInvestigationStep(current, { index: 3, title: 't', status: 'weird', calls: [] })
    ).toBe(current);
    expect(mergeInvestigationStep(current, null)).toBe(current);
  });
});
