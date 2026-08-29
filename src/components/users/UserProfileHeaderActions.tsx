'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Edit2 } from 'lucide-react';
import UserEditModal, { type UserEditData } from './UserEditModal';

type UserProfileHeaderActionsProps = {
  user: UserEditData;
  canManage: boolean;
  canManageRole: boolean;
  updateProfile: (
    userId: string,
    formData: FormData
  ) => Promise<{ error?: string; success?: boolean } | undefined>;
};

export default function UserProfileHeaderActions({
  user,
  canManage,
  canManageRole,
  updateProfile,
}: UserProfileHeaderActionsProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <Button
        onClick={() => setIsEditOpen(true)}
        variant="outline"
        size="sm"
        className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs font-semibold h-9 gap-1.5 shadow-xs w-full lg:w-auto"
      >
        <Edit2 className="h-3.5 w-3.5" />
        Edit Profile
      </Button>

      {isEditOpen && (
        <UserEditModal
          user={user}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          canManageRole={canManageRole}
          updateProfile={updateProfile}
        />
      )}
    </>
  );
}
