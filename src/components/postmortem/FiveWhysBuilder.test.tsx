import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FiveWhysBuilder from './FiveWhysBuilder';

describe('FiveWhysBuilder', () => {
  it('renders step questions and answers in view mode', () => {
    const customSteps = [
      { id: '1', question: 'Why did the API slow down?', answer: 'Database connections spiked.' },
      { id: '2', question: 'Why did connections spike?', answer: 'Missing query index.' },
    ];

    render(<FiveWhysBuilder initialSteps={customSteps} isEditable={false} />);

    expect(screen.getByText(/Why #1: Why did the API slow down?/i)).toBeInTheDocument();
    expect(screen.getByText('Database connections spiked.')).toBeInTheDocument();
    expect(screen.getByText(/🎯 Root Cause Finding/i)).toBeInTheDocument();
  });

  it('allows adding and editing steps in editable mode', () => {
    const onChange = vi.fn();
    render(<FiveWhysBuilder isEditable={true} onChange={onChange} />);

    const addButton = screen.getByRole('button', { name: /add why step/i });
    expect(addButton).toBeInTheDocument();
    fireEvent.click(addButton);

    expect(onChange).toHaveBeenCalled();
  });
});
