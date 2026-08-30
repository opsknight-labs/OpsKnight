import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuditActionBadge, { getActionCategory } from './AuditActionBadge';

describe('AuditActionBadge', () => {
  it('correctly maps action categories', () => {
    expect(getActionCategory('LOGIN_SUCCESS')).toBe('success');
    expect(getActionCategory('USER_CREATE')).toBe('success');
    expect(getActionCategory('USER_DELETE')).toBe('danger');
    expect(getActionCategory('LOGIN_FAILED')).toBe('danger');
    expect(getActionCategory('USER_UPDATE')).toBe('info');
    expect(getActionCategory('SLA_BREACH_WARNING')).toBe('warning');
    expect(getActionCategory('SYSTEM_CONFIG')).toBe('neutral');
  });

  it('renders action text with semantic styling', () => {
    render(<AuditActionBadge action="LOGIN_SUCCESS" />);
    const badge = screen.getByText('LOGIN_SUCCESS');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-emerald-700');
  });
});
