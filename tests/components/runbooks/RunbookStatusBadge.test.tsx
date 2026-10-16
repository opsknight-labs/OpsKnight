import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';

describe('RunbookStatusBadge', () => {
  it('renders Unknown outcome with danger styling by default', () => {
    render(<RunbookStatusBadge status="UNKNOWN" />);
    expect(screen.getByText('Unknown outcome')).toBeInTheDocument();
  });

  it('renders Health unknown with neutral styling when context is health', () => {
    render(<RunbookStatusBadge status="UNKNOWN" context="health" />);
    expect(screen.getByText('Health unknown')).toBeInTheDocument();
  });

  it('renders standard execution statuses correctly', () => {
    render(<RunbookStatusBadge status="SUCCEEDED" />);
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });

  it('renders agent statuses correctly', () => {
    render(<RunbookStatusBadge status="OFFLINE" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('uses readable sentence-case labels for multi-word and unmapped statuses', () => {
    render(
      <>
        <RunbookStatusBadge status="WAITING_APPROVAL" />
        <RunbookStatusBadge status="CANCEL_REQUESTED" />
        <RunbookStatusBadge status="SOME_NEW_STATE" />
      </>
    );
    expect(screen.getByText('Waiting approval')).toBeInTheDocument();
    expect(screen.getByText('Cancel requested')).toBeInTheDocument();
    expect(screen.getByText('Some new state')).toBeInTheDocument();
  });
});
