import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeletePolicyCard from '@/app/(app)/policies/[id]/DeletePolicyCard';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock useToast hook
vi.mock('@hooks/use-product-notification', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

describe('DeletePolicyCard', () => {
  const dummyAction = vi.fn().mockResolvedValue({ success: true });

  it('renders blocked state when policy has dependent services', () => {
    render(
      <DeletePolicyCard
        policyId="pol-1"
        policyName="Primary Escalation"
        servicesUsingPolicy={[
          { id: 'srv-1', name: 'Authentication API' },
          { id: 'srv-2', name: 'Billing Gateway' },
        ]}
        deletePolicyAction={dummyAction}
      />
    );

    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    expect(screen.getByText('Policy In Use — Deletion Blocked')).toBeInTheDocument();
    expect(screen.getByText('Authentication API')).toBeInTheDocument();
    expect(screen.getByText('Billing Gateway')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: /delete policy/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('renders confirmation trigger when policy has no dependent services', () => {
    render(
      <DeletePolicyCard
        policyId="pol-2"
        policyName="Unused Escalation"
        servicesUsingPolicy={[]}
        deletePolicyAction={dummyAction}
      />
    );

    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    expect(screen.getByText('Delete this escalation policy')).toBeInTheDocument();

    const deleteBtn = screen.getByRole('button', { name: /delete policy/i });
    expect(deleteBtn).toBeEnabled();

    // Click triggers alert dialog
    fireEvent.click(deleteBtn);
    expect(screen.getByText('Delete Policy Permanently')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();
  });
});
