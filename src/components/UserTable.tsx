'use client';

import { useState, useTransition, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import RoleSelector from './RoleSelector';
import InviteLinkButton from './InviteLinkButton';
import DeleteUserButton from './DeleteUserButton';
import GenerateResetLinkButton from './GenerateResetLinkButton';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import UserAvatar from '@/components/UserAvatar';

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  gender?: string | null;
  createdAt?: Date;
  teamMemberships?: Array<{
    id: string;
    role: string;
    teamId: string;
    team: { name: string };
  }>;
};

type UserTableProps = {
  users: User[];
  teams: Array<{ id: string; name: string }>;
  ownerCountByTeam: Map<string, number>;
  currentUserId: string;
  currentUserRole: string;
  isAdmin: boolean;
  isAdminOrResponder: boolean;
  updateUserRole: (userId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  deactivateUser: (userId: string, formData?: FormData) => Promise<{ error?: string } | undefined>;
  reactivateUser: (userId: string, formData?: FormData) => Promise<{ error?: string } | undefined>;
  deleteUser: (userId: string, formData?: FormData) => Promise<{ error?: string } | undefined>;
  generateInvite: (userId: string, prevState: any, formData: FormData) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  addUserToTeam: (userId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  sortBy?: string;
  sortOrder?: string;
};

export default function UserTable({
  users,
  teams,
  ownerCountByTeam,
  currentUserId,
  currentUserRole: _currentUserRole,
  isAdmin,
  isAdminOrResponder,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  deleteUser,
  generateInvite,
  addUserToTeam,
  sortBy = 'createdAt',
  sortOrder = 'desc',
}: UserTableProps) {
  const { userTimeZone } = useTimezone();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Build sort URL function on client side - memoized with useCallback
  const buildSortUrl = useCallback(
    (newSortBy: string): string => {
      const params = new URLSearchParams(searchParams.toString());
      if (sortBy === newSortBy && sortOrder === 'asc') {
        // If already sorted by this field ascending, switch to descending
        params.set('sortBy', newSortBy);
        params.set('sortOrder', 'desc');
      } else if (sortBy === newSortBy) {
        // If already sorted by this field descending, remove sort (default)
        params.delete('sortBy');
        params.delete('sortOrder');
      } else {
        // New field, sort ascending
        params.set('sortBy', newSortBy);
        params.set('sortOrder', 'asc');
      }
      params.delete('page'); // Reset to page 1 when sorting
      return `${pathname}?${params.toString()}`;
    },
    [searchParams, pathname, sortBy, sortOrder]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [_isPending, _startTransition] = useTransition();

  // Memoize toggle functions to prevent unnecessary re-renders
  const toggleUser = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === users.length) {
        return new Set();
      } else {
        return new Set(users.map(u => u.id));
      }
    });
  }, [users]);

  // Memoize computed values
  const allSelected = useMemo(
    () => users.length > 0 && selectedIds.size === users.length,
    [users.length, selectedIds.size]
  );
  const someSelected = useMemo(
    () => selectedIds.size > 0 && selectedIds.size < users.length,
    [selectedIds.size, users.length]
  );

  return (
    <div
      style={{
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <table
        style={{
          width: '100%',
          minWidth: '900px',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
        }}
      >
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid var(--border)' }}>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
                width: '40px',
              }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={input => {
                  if (input) input.indeterminate = someSelected;
                }}
                onChange={toggleAll}
                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                aria-label="Select all users"
              />
            </th>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
              }}
            >
              {buildSortUrl ? (
                <Link
                  href={buildSortUrl('name')}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  User
                  {sortBy === 'name' && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)' }}>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </Link>
              ) : (
                'User'
              )}
            </th>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
                width: '140px',
              }}
            >
              Role
            </th>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
                width: '100px',
              }}
            >
              {buildSortUrl ? (
                <Link
                  href={buildSortUrl('status')}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  Status
                  {sortBy === 'status' && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)' }}>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </Link>
              ) : (
                'Status'
              )}
            </th>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
              }}
            >
              Teams
            </th>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
                width: '140px',
              }}
            >
              {buildSortUrl ? (
                <Link
                  href={buildSortUrl('createdAt')}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  Created
                  {sortBy === 'createdAt' && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary-color)' }}>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </Link>
              ) : (
                'Created'
              )}
            </th>
            <th
              style={{
                padding: '0.75rem 1rem',
                textAlign: 'right',
                fontWeight: '600',
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-secondary)',
                width: '120px',
              }}
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => {
            const updateRole = async (formData: FormData) => {
              await updateUserRole(user.id, formData);
            };
            const deactivate = async (formData?: FormData) => {
              await deactivateUser(user.id, formData);
            };
            const _reactivate = async (formData?: FormData) => {
              await reactivateUser(user.id, formData);
            };
            const removeUser = async (formData?: FormData) => {
              await deleteUser(user.id, formData);
            };
            const inviteUser = generateInvite.bind(null, user.id);
            const assignToTeam = async (formData: FormData) => {
              await addUserToTeam(user.id, formData);
            };
            const availableTeams = teams.filter(
              team => !user.teamMemberships?.some(member => member.teamId === team.id)
            );
            const isSoleOwner = user.teamMemberships?.some(
              member => member.role === 'OWNER' && ownerCountByTeam.get(member.teamId) === 1
            );

            return (
              <tr
                key={user.id}
                style={{
                  borderBottom: '1px solid #f1f5f9',
                }}
                className="user-table-row"
              >
                <td style={{ padding: '0.875rem 1rem' }}>
                  <input
                    type="checkbox"
                    name="userIds"
                    value={user.id}
                    form="bulk-users-form"
                    checked={selectedIds.has(user.id)}
                    onChange={() => toggleUser(user.id)}
                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                  />
                </td>
                <td style={{ padding: '0.875rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <UserAvatar
                      userId={user.id}
                      avatarUrl={user.avatarUrl}
                      name={user.name}
                      gender={user.gender}
                      size="md"
                    />
                    <div>
                      <div
                        style={{ fontWeight: '600', fontSize: '0.9rem', marginBottom: '0.15rem' }}
                      >
                        {user.name}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {user.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '0.875rem 1rem' }}>
                  {isAdmin && user.id !== currentUserId ? (
                    <RoleSelector
                      userId={user.id}
                      currentRole={user.role}
                      updateRole={updateRole}
                    />
                  ) : (
                    <span
                      style={{
                        padding: '0.4rem 0.6rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        background: '#f9fafb',
                        color: 'var(--text-secondary)',
                        fontWeight: '500',
                      }}
                    >
                      {user.role === 'ADMIN'
                        ? 'Admin'
                        : user.role === 'RESPONDER'
                          ? 'Responder'
                          : user.role === 'AUDITOR'
                            ? 'Auditor'
                            : 'User'}
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.875rem 1rem' }}>
                  <span
                    style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      fontSize: '0.7rem',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      background:
                        user.status === 'ACTIVE'
                          ? '#e6f4ea'
                          : user.status === 'INVITED'
                            ? '#fff3e0'
                            : 'var(--color-neutral-100)',
                      color:
                        user.status === 'ACTIVE'
                          ? '#0f5132'
                          : user.status === 'INVITED'
                            ? '#b45309'
                            : 'var(--text-secondary)',
                      display: 'inline-block',
                    }}
                  >
                    {user.status}
                  </span>
                </td>
                <td style={{ padding: '0.875rem 1rem' }}>
                  {!user.teamMemberships || user.teamMemberships.length === 0 ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {user.teamMemberships.slice(0, 2).map(member => (
                        <span
                          key={member.id}
                          style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: '600',
                            background:
                              member.role === 'OWNER'
                                ? 'var(--color-neutral-100)'
                                : member.role === 'ADMIN'
                                  ? '#fef3c7'
                                  : '#ecfdf5',
                            color:
                              member.role === 'OWNER'
                                ? 'var(--text-secondary)'
                                : member.role === 'ADMIN'
                                  ? '#78350f'
                                  : '#065f46',
                          }}
                          title={`${member.team.name} (${member.role})`}
                        >
                          {member.team.name}
                        </span>
                      ))}
                      {user.teamMemberships.length > 2 && (
                        <span
                          style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
                          title={user.teamMemberships
                            .slice(2)
                            .map(m => `${m.team.name} (${m.role})`)
                            .join(', ')}
                        >
                          +{user.teamMemberships.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                  {availableTeams.length > 0 && isAdminOrResponder && (
                    <form
                      action={assignToTeam}
                      style={{
                        marginTop: '0.4rem',
                        display: 'flex',
                        gap: '0.3rem',
                        alignItems: 'center',
                      }}
                    >
                      <select
                        name="teamId"
                        defaultValue=""
                        style={{
                          padding: '0.25rem 0.4rem',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          minWidth: '100px',
                          background: 'white',
                        }}
                      >
                        <option value="" disabled>
                          Add team
                        </option>
                        {availableTeams.map(team => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                      <select
                        name="role"
                        defaultValue="MEMBER"
                        style={{
                          padding: '0.25rem 0.4rem',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          background: 'white',
                        }}
                      >
                        <option value="MEMBER">Member</option>
                        {isAdmin && <option value="ADMIN">Admin</option>}
                        {isAdmin && <option value="OWNER">Owner</option>}
                      </select>
                      <button
                        type="submit"
                        className="glass-button"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                      >
                        Add
                      </button>
                    </form>
                  )}
                </td>
                <td
                  style={{
                    padding: '0.875rem 1rem',
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                  }}
                >
                  {user.createdAt ? (
                    formatDateTime(user.createdAt, userTimeZone, { format: 'datetime' })
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.4rem',
                      justifyContent: 'flex-end',
                      flexWrap: 'wrap',
                    }}
                  >
                    {isAdmin && (
                      <>
                        {user.status === 'INVITED' && (
                          <InviteLinkButton action={inviteUser} className="invite-link-inline" />
                        )}
                        {user.status === 'ACTIVE' && (
                          <GenerateResetLinkButton userId={user.id} userName={user.name} />
                        )}
                        {user.status === 'ACTIVE' && user.id !== currentUserId && (
                          <form action={deactivate}>
                            <button
                              type="submit"
                              className="glass-button"
                              style={{
                                padding: '0.35rem 0.7rem',
                                fontSize: '0.7rem',
                                background: 'white',
                                color: '#ef4444',
                                border: '1px solid #fee2e2',
                              }}
                            >
                              Deactivate
                            </button>
                          </form>
                        )}
                        {user.status === 'DISABLED' && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                            }}
                            title="User must be re-invited to set a new password"
                          >
                            Deactivated
                          </span>
                        )}
                        {user.id === currentUserId && user.status === 'ACTIVE' && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                            }}
                            title="You cannot deactivate your own account"
                          >
                            Cannot deactivate self
                          </span>
                        )}
                        {user.id !== currentUserId && (
                          <DeleteUserButton
                            action={removeUser}
                            className={isSoleOwner ? 'glass-button' : 'glass-button'}
                            disabled={isSoleOwner}
                            title={
                              isSoleOwner
                                ? 'Reassign team ownership before deleting this user.'
                                : 'Delete user'
                            }
                          />
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
