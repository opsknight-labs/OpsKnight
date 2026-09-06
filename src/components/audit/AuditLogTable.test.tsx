import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AuditLogTable from './AuditLogTable';

describe('AuditLogTable', () => {
  const sampleLogs = [
    {
      id: 'aud_1',
      createdAt: '2026-08-30T17:00:00.000Z',
      action: 'LOGIN_SUCCESS',
      entityType: 'USER',
      entityId: 'usr_1',
      actorName: 'Dushyant',
      actorEmail: 'admin@opsknight.com',
      actor: {
        id: 'usr_1',
        name: 'Dushyant',
        email: 'admin@opsknight.com',
        avatarUrl: null,
      },
      details: '{"ip":"127.0.0.1"}',
    },
  ];

  it('renders audit rows and opens modal on click', () => {
    render(
      <AuditLogTable
        logs={sampleLogs}
        userTimeZone="UTC"
        page={1}
        pageSize={50}
        totalCount={1}
        prevHref={undefined}
        nextHref={undefined}
      />
    );

    expect(screen.getByText('Dushyant')).toBeInTheDocument();
    expect(screen.getByText('LOGIN_SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('usr_1')).toBeInTheDocument();

    const viewButton = screen.getByRole('button', { name: /view/i });
    fireEvent.click(viewButton);

    expect(screen.getByText('Audit Record Details')).toBeInTheDocument();
  });

  it('renders empty state when no logs exist', () => {
    render(
      <AuditLogTable
        logs={[]}
        userTimeZone="UTC"
        page={1}
        pageSize={50}
        totalCount={0}
        hasFilters={true}
      />
    );

    expect(screen.getByText('No matching audit entries')).toBeInTheDocument();
  });
});
