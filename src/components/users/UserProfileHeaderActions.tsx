'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Edit2, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { notify as toast } from '@/lib/toast';
import UserEditModal, { type UserEditData } from './UserEditModal';

type UserProfileHeaderActionsProps = {
  user: UserEditData & { status?: string };
  canManage: boolean;
  canManageRole: boolean;
  isSelf?: boolean;
  updateProfile: (
    userId: string,
    formData: FormData
  ) => Promise<{ error?: string; success?: boolean } | undefined>;
  deleteUser?: (userId: string) => Promise<{ error?: string } | undefined>;
};

export default function UserProfileHeaderActions({
  user,
  canManage,
  canManageRole,
  isSelf = false,
  updateProfile,
  deleteUser,
}: UserProfileHeaderActionsProps) {
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, startDeleting] = useTransition();

  if (!canManage) return null;

  const isInvited = user.status === 'INVITED';
  const isDisabled = user.status === 'DISABLED';
  const canDelete = Boolean(canManageRole && !isSelf && (isInvited || isDisabled) && deleteUser);

  const handleDelete = () => {
    if (!deleteUser) return;
    startDeleting(async () => {
      try {
        const result = await deleteUser(user.id);
        if (result?.error) {
          toast.error(result.error);
        } else {
          toast.success(isInvited ? 'Invitation deleted' : 'User permanently deleted');
          setIsDeleteOpen(false);
          router.push('/users');
          router.refresh();
        }
      } catch {
        toast.error('Failed to delete user');
      }
    });
  };

  return (
    <>
      <div className="flex items-center gap-2 w-full lg:w-auto">
        <Button
          onClick={() => setIsEditOpen(true)}
          variant="outline"
          size="sm"
          className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs font-semibold h-9 gap-1.5 shadow-xs flex-1 lg:flex-none cursor-pointer"
        >
          <Edit2 className="h-3.5 w-3.5" />
          Edit Profile
        </Button>

        {canDelete && (
          <Button
            onClick={() => setIsDeleteOpen(true)}
            variant="outline"
            size="sm"
            className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-400/30 hover:border-rose-400/50 text-xs font-semibold h-9 gap-1.5 shadow-xs flex-1 lg:flex-none cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-300" />
            {isInvited ? 'Delete Invitation' : 'Delete User'}
          </Button>
        )}
      </div>

      {isEditOpen && (
        <UserEditModal
          user={user}
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          canManageRole={canManageRole}
          updateProfile={updateProfile}
        />
      )}

      {canDelete && (
        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                {isInvited ? 'Delete Invited User' : 'Delete User Permanently'}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="text-red-600 font-semibold block">
                  This action cannot be undone.
                </span>
                {isInvited ? (
                  <span>
                    Permanently deletes the invitation for <strong>{user.name}</strong> (
                    {user.email}). Any invitation links already sent will be immediately
                    invalidated, and this pending account will be removed.
                  </span>
                ) : (
                  <span>
                    Permanently removes <strong>{user.name}</strong>&apos;s account and personal
                    credentials. Historical records retained for operational evidence will remain.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={e => {
                  e.preventDefault();
                  handleDelete();
                }}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    Deleting...
                  </>
                ) : isInvited ? (
                  'Delete Invitation'
                ) : (
                  'Delete Permanently'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
