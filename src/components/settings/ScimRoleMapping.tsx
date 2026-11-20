'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  getScimRoleMappingAction,
  previewScimRoleMappingAction,
  saveScimRoleMappingAction,
} from '@/app/(app)/settings/system/scim-role-actions';

type Role = 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
type Data<T> = Exclude<Awaited<T>, { scimError: string }>;
type Impact = Data<ReturnType<typeof previewScimRoleMappingAction>>;
async function unwrap<T>(pending: Promise<T>): Promise<Data<T>> {
  const value = await pending;
  if (value && typeof value === 'object' && 'scimError' in value)
    throw new Error(String(value.scimError));
  return value as Data<T>;
}

export default function ScimRoleMapping({
  connectorId,
  groupId,
  onSaved,
}: {
  connectorId: string;
  groupId: string;
  onSaved: () => void;
}) {
  const [group, setGroup] = useState<Data<ReturnType<typeof getScimRoleMappingAction>> | null>(
    null
  );
  const [role, setRole] = useState<Role | ''>('');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let current = true;
    void unwrap(getScimRoleMappingAction({ connectorId, groupId }))
      .then(value => {
        if (current) {
          setGroup(value);
          setRole(value.systemRole ?? '');
        }
      })
      .catch(e => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [connectorId, groupId]);
  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      setImpact(null);
      setError(e instanceof Error ? e.message : 'Cannot update role mapping.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Group system role" className="rounded-lg border p-4 space-y-3">
      <h4 className="font-semibold">System role for {group?.name ?? 'this group'}</h4>
      <p className="text-sm text-muted-foreground">
        Map this synced group to an OpsKnight role. Changes apply now and on group sync, without a
        sign-in. Overlapping groups use Admin, then Responder, Auditor, User. Removing the last
        mapping returns SCIM-managed accounts to User.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <label className="block text-sm">
        OpsKnight system role
        <select
          aria-label="OpsKnight system role"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          disabled={!group || busy}
          value={role}
          onChange={e => {
            setRole(e.target.value as Role | '');
            setImpact(null);
            setNotice('');
          }}
        >
          <option value="">No role mapping</option>
          <option value="ADMIN">Admin</option>
          <option value="RESPONDER">Responder</option>
          <option value="AUDITOR">Auditor</option>
          <option value="USER">User</option>
        </select>
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={!group || busy}
        onClick={() =>
          void run(async () => {
            setImpact(
              await unwrap(
                previewScimRoleMappingAction({ connectorId, groupId, role: role || null })
              )
            );
          })
        }
      >
        Preview role mapping
      </Button>
      {impact && (
        <div className="rounded-md border p-3 space-y-3">
          <p role="status" className="text-sm">
            {impact.members} group members; {impact.changedUsers} accounts change;{' '}
            {impact.adoptedUsers} move under SCIM group role control; {impact.demotions} lose Admin.
          </p>
          <p className="text-sm text-muted-foreground">
            SCIM will control mapped members’ roles, including future additions. OIDC cannot
            overwrite SCIM roles. Manual edits may be reasserted on the next group sync. Role
            changes sign affected users out. The last active admin is protected.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const saved = await unwrap(
                  saveScimRoleMappingAction({
                    connectorId,
                    groupId,
                    role: role || null,
                    revision: impact.revision,
                  })
                );
                setGroup(previous =>
                  previous ? { ...previous, systemRole: role || null } : previous
                );
                setImpact(null);
                setNotice(`Role mapping saved. ${saved.changedUsers} accounts updated.`);
                onSaved();
              })
            }
          >
            Apply role mapping
          </Button>
        </div>
      )}
    </section>
  );
}
