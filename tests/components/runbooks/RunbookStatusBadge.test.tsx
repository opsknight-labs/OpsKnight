import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';

describe('RunbookStatusBadge', () => {
  it('renders Unknown Outcome with danger styling by default', () => {
    render(<RunbookStatusBadge status="UNKNOWN" />);
    expect(screen.getByText('Unknown Outcome')).toBeInTheDocument();
  });

  it('renders Health Unknown with neutral styling when context is health', () => {
    render(<RunbookStatusBadge status="UNKNOWN" context="health" />);
    expect(screen.getByText('Health Unknown')).toBeInTheDocument();
  });

  it('renders standard execution statuses correctly', () => {
    render(<RunbookStatusBadge status="SUCCEEDED" />);
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
  });

  it('renders agent statuses correctly', () => {
    render(<RunbookStatusBadge status="OFFLINE" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
