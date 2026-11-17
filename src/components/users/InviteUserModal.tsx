'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { UserPlus } from 'lucide-react';
import UserCreateForm from '@/components/UserCreateForm';

type FormState = {
  error?: string | null;
  success?: boolean;
  inviteUrl?: string | null;
  emailSent?: boolean;
  providerConfigured?: boolean;
  providerName?: string | null;
  recipientEmail?: string | null;
};

type InviteUserModalProps = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'secondary' | 'banner' | 'topbar';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  label?: string;
};

export default function InviteUserModal({
  action,
  disabled = false,
  variant = 'default',
  size = 'default',
  className,
  label = 'Invite User',
}: InviteUserModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant === 'banner' || variant === 'topbar' ? 'default' : variant}
          size={size}
          disabled={disabled}
          className={className}
        >
          <UserPlus aria-hidden="true" />
          <span>{label}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[490px] w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden p-5 sm:p-6 rounded-2xl border shadow-2xl">
        <DialogHeader className="space-y-1.5 pb-2">
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Send an onboarding invitation and configure initial role permissions for this team
            member.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-2 w-full max-w-full min-w-0">
          <UserCreateForm action={action} disabled={disabled} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
