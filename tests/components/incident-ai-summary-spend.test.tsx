import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const summarize = vi.hoisted(() => vi.fn());
vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  summarizeIncidentAction: summarize,
}));
vi.mock('@/components/incident/intelligence/PostSummaryAsNoteButton', () => ({
  default: () => null,
}));
import IncidentAiSummary from '@/components/incident/IncidentAiSummary';
import { AI_LEAN_NOTICE } from '@/lib/intelligence/ai/contract';

const summary = {
  headline: 'Checkout errors',
  currentState: 'Monitoring.',
  keyEvents: [],
  possibleCauses: [],
  nextSteps: [],
};

it('says when a summary came from the smaller model near the budget', async () => {
  summarize.mockResolvedValueOnce({
    status: 'ok',
    summary,
    model: 'gpt-5-mini',
    promptVersion: 1,
    degraded: true,
  });
  render(<IncidentAiSummary incidentId="i1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Summarise this incident' }));
  expect(await screen.findByText(AI_LEAN_NOTICE)).toBeInTheDocument();
});

it('shows no budget notice on a normal summary', async () => {
  summarize.mockResolvedValueOnce({ status: 'ok', summary, model: 'gpt-5', promptVersion: 1 });
  render(<IncidentAiSummary incidentId="i1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Summarise this incident' }));
  expect(await screen.findByText('Checkout errors')).toBeInTheDocument();
  expect(screen.queryByText(AI_LEAN_NOTICE)).toBeNull();
});
