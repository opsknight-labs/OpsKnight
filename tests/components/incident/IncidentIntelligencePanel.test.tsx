import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import IncidentIntelligencePanel from '@/components/incident/IncidentIntelligencePanel';
it('keeps recommendation freshness and its polling controls inside the tabs they describe', () => {
  render(
    <IncidentIntelligencePanel
      similar="Similar content"
      related="Related content"
      response="Response content"
      summary="Summary content"
      assistant="Assistant content"
      analysisStatus={<p role="status">Recommendation state</p>}
    />
  );
  expect(screen.getByRole('status')).toBeVisible();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Related' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Causes & runbooks' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByRole('status')).toBeVisible();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Ask Squire' }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
