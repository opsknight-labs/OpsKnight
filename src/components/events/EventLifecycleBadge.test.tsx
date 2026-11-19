import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EventLifecycleBadge, { getEventCategory } from './EventLifecycleBadge';

describe('EventLifecycleBadge', () => {
  it('correctly maps message categories', () => {
    expect(getEventCategory('Incident triggered by alert')).toBe('triggered');
    expect(getEventCategory('Incident acknowledged by responder')).toBe('acknowledged');
    expect(getEventCategory('Incident resolved successfully')).toBe('resolved');
    expect(getEventCategory('Incident escalated to Tier 2')).toBe('escalated');
    expect(getEventCategory('Note added in Slack war room')).toBe('note');
    expect(getEventCategory('Custom webhook received')).toBe('general');
  });

  it('prefers the typed column and does not mislabel held or reassigned events', () => {
    expect(getEventCategory('Incident manually reassigned to Bob', 'ASSIGNMENT')).toBe('escalated');
    expect(getEventCategory('Service looks healthy again', 'COMMENT')).toBe('note');
    expect(getEventCategory('Incident manually reassigned to Bob')).toBe('escalated');
    expect(
      getEventCategory('Incident created in SUPPRESSED state: rapid alert oscillations detected')
    ).toBe('general');
  });

  it('renders badge for triggered incident', () => {
    render(<EventLifecycleBadge message="Incident triggered by high latency" />);
    expect(screen.getByText('TRIGGER')).toBeInTheDocument();
  });
});
