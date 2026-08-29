'use client';

import { useTransition } from 'react';

type RoleSelectorProps = {
  userId: string;
  currentRole: string;
  updateRole: (formData: FormData) => Promise<unknown>;
};

export default function RoleSelector({
  userId: _userId,
  currentRole,
  updateRole,
}: RoleSelectorProps) {
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const formData = new FormData();
    formData.set('role', e.target.value);

    startTransition(async () => {
      await updateRole(formData);
    });
  };

  return (
    <select
      name="role"
      defaultValue={currentRole}
      onChange={handleChange}
      disabled={isPending}
      style={{
        padding: '0.4rem 0.6rem',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        fontSize: '0.8rem',
        width: '100%',
        background: 'white',
        cursor: isPending ? 'wait' : 'pointer',
        fontWeight: '500',
        opacity: isPending ? 0.6 : 1,
      }}
    >
      <option value="ADMIN">Admin</option>
      <option value="RESPONDER">Responder</option>
      <option value="AUDITOR">Auditor</option>
      <option value="USER">User</option>
    </select>
  );
}
