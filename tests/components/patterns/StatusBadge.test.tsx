import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '@/components/patterns/StatusBadge';
import SeverityBadge from '@/components/patterns/SeverityBadge';

describe('StatusBadge', () => {
  it.each([
    ['OPEN', 'Triggered', 'critical'],
    ['TRIGGERED', 'Triggered', 'critical'],
    ['ACKNOWLEDGED', 'Acknowledged', 'elevated'],
    ['SNOOZED', 'Snoozed', 'info'],
    ['SUPPRESSED', 'Suppressed', 'neutral'],
    ['RESOLVED', 'Resolved', 'ok'],
  ])('renders %s as "%s" with an icon on the %s tone', (status, label, tone) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-tone', tone);
    // Not colour alone: an icon always accompanies the label.
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('pairs palette fills with dark-mode classes and stays out of the forced-colours opt-out', () => {
    const { container } = render(<StatusBadge status="OPEN" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-status-critical-soft');
    expect(badge.className).toContain('dark:text-rose-300');
    // `[data-badge]` opts out of forced colours in badges.css; status pills must not.
    expect(badge).not.toHaveAttribute('data-badge');
    expect(badge.className).toContain('border');
  });

  it('only pulses for live critical incidents', () => {
    const { container, rerender } = render(<StatusBadge status="OPEN" live />);
    expect(container.querySelector('.motion-safe\\:animate-ping')).not.toBeNull();
    rerender(<StatusBadge status="RESOLVED" live />);
    expect(container.querySelector('.motion-safe\\:animate-ping')).toBeNull();
  });
});

describe('SeverityBadge', () => {
  it('maps urgency to palette tones with an accessible name', () => {
    const { container } = render(<SeverityBadge urgency="MEDIUM" abbreviate />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge).toHaveAttribute('data-tone', 'elevated');
    expect(screen.getByText('Med')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Medium urgency')).toHaveClass('sr-only');
  });

  it('reads as "High urgency" / "Priority P1" without duplicating the visible text', () => {
    const { container } = render(
      <>
        <SeverityBadge urgency="HIGH" />
        <SeverityBadge priority="P1" showLabel={false} />
      </>
    );
    expect(container.children[0].textContent).toBe('High urgency');
    expect(container.children[1].textContent).toBe('Priority P1');
    expect(screen.getAllByText(/P1/)).toHaveLength(1);
  });

  it('maps low urgency to info (never success)', () => {
    const { container } = render(<SeverityBadge urgency="LOW" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'info');
  });

  it('renders priorities with optional names and neutral P5', () => {
    const { container, rerender } = render(<SeverityBadge priority="P1" />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'critical');
    expect(screen.getByText('P1 · Crisis')).toBeInTheDocument();
    rerender(<SeverityBadge priority="P5" showLabel={false} />);
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'neutral');
    expect(screen.getByText('P5')).toBeInTheDocument();
  });

  it('renders nothing without a value', () => {
    const { container } = render(<SeverityBadge urgency={null} />);
    expect(container.firstChild).toBeNull();
  });
});
