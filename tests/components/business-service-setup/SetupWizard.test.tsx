import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const refresh = vi.fn();
const createFromSetupAction = vi.fn();
const suggestMembersAction = vi.fn();
const importBusinessServicesAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/toast', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/app/(app)/services/business/setup/actions', () => ({
  createFromSetupAction: (...args: unknown[]) => createFromSetupAction(...args),
  suggestMembersAction: (...args: unknown[]) => suggestMembersAction(...args),
  importBusinessServicesAction: (...args: unknown[]) => importBusinessServicesAction(...args),
}));

import SetupWizard from '@/components/business-service-setup/SetupWizard';
import ImportBusinessServicesButton from '@/components/business-service-import/ImportDialog';

const services = [
  { id: 's-api', name: 'checkout-api', hint: 'Payments' },
  { id: 's-db', name: 'orders-db', hint: null },
];
const teams = [{ id: 't-fin', name: 'Finance' }];
const statusPages = [{ id: 'p-1', name: 'Public status' }];

describe('business-service setup wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFromSetupAction.mockResolvedValue({ ok: true, id: 'bs-1', warnings: [] });
    suggestMembersAction.mockResolvedValue([{ id: 's-db', name: 'orders-db' }]);
  });

  it('walks name → services (with a dependency suggestion) → status page → subscribers and creates', async () => {
    render(<SetupWizard services={services} teams={teams} statusPages={statusPages} />);
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Checkout' } });
    next();

    fireEvent.click(screen.getByRole('checkbox', { name: /checkout-api/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest related services' }));
    await waitFor(() => expect(suggestMembersAction).toHaveBeenCalledWith(['s-api']));
    fireEvent.click(await screen.findByRole('button', { name: 'orders-db' }));
    next(); // ownership: keep defaults
    next(); // status pages
    fireEvent.click(screen.getByRole('checkbox', { name: /Public status/ }));
    next(); // subscribers
    fireEvent.click(screen.getByRole('checkbox', { name: /Finance/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Subscribe all users/ }));
    next(); // review
    expect(screen.getByRole('heading', { name: 'Step 6 of 6: Review' })).toHaveFocus();
    const review = screen.getByLabelText('Review');
    expect(review).toHaveTextContent('checkout-api, orders-db');
    expect(review).toHaveTextContent('Public status');
    expect(review).toHaveTextContent('Finance · All users');
    fireEvent.click(screen.getByRole('button', { name: 'Create business service' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/services/business/bs-1'));
    expect(createFromSetupAction).toHaveBeenCalledWith({
      name: 'Checkout',
      description: null,
      memberServiceIds: ['s-api', 's-db'],
      ownerTeamId: null,
      criticality: null,
      impactMinUrgency: null,
      impactMaxPriority: null,
      statusPageIds: ['p-1'],
      subscriberTeamIds: ['t-fin'],
      subscribeAllUsers: true,
    });
  });

  it('explains when the person cannot manage status pages and shows a create failure', async () => {
    createFromSetupAction.mockResolvedValue({ ok: false, error: 'Name taken.' });
    render(<SetupWizard services={services} teams={teams} statusPages={[]} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Checkout' } });
    for (let index = 0; index < 3; index += 1)
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/No status pages you can manage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The review step can jump back to any step.
    fireEvent.click(screen.getByRole('button', { name: 'Edit services' }));
    expect(screen.getByRole('heading', { name: 'Step 2 of 6: Services' })).toBeInTheDocument();
    for (let index = 0; index < 4; index += 1)
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create business service' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name taken.');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('business-service import dialog', () => {
  it('previews the diff, blocks apply on issues, and applies a clean file', async () => {
    importBusinessServicesAction
      .mockResolvedValueOnce({
        ok: true,
        result: {
          applied: false,
          summary: { create: 0, update: 0, unchanged: 0, invalid: 1 },
          changes: [],
          issues: [{ line: 2, name: 'Checkout', message: 'Unknown service "nope".' }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          applied: false,
          summary: { create: 1, update: 0, unchanged: 0, invalid: 0 },
          changes: [
            {
              line: 2,
              name: 'Checkout',
              action: 'create',
              fields: ['name'],
              membersAdded: ['checkout-api'],
              membersRemoved: [],
            },
          ],
          issues: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          applied: true,
          summary: { create: 1, update: 0, unchanged: 0, invalid: 0 },
          changes: [],
          issues: [],
        },
      });
    render(<ImportBusinessServicesButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const box = screen.getByLabelText('Or paste it');
    fireEvent.change(box, { target: { value: 'name,members\nCheckout,nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText(/Unknown service "nope"/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply import' })).not.toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'name,members\nCheckout,checkout-api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText('+ checkout-api')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply import' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(importBusinessServicesAction).toHaveBeenLastCalledWith({
      format: 'csv',
      content: 'name,members\nCheckout,checkout-api',
      dryRun: false,
    });
  });
});
