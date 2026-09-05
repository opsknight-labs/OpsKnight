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
import { cn } from '@/lib/utils';

type FormState = {
  error?: string | null;
  success?: boolean;
  inviteUrl?: string | null;
  emailSent?: boolean;
};

type InviteUserModalProps = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  disabled?: boolean;
  variant?: 'default' | 'outline' | 'secondary' | 'banner';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  label?: string;
};

export default function InviteUserModal({
  action,
  disabled = false,
  variant = 'default',
  size = 'sm',
  className,
  label = 'Invite User',
}: InviteUserModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === 'banner' ? (
          <Button
            type="button"
            disabled={disabled}
            className={cn(
              'h-9 px-3.5 font-semibold text-xs gap-2 rounded-lg transition-all duration-200 shadow-xs shrink-0 select-none cursor-pointer',
              'bg-[#18181b] hover:bg-[#27272a] active:bg-[#2e2e33] text-white border border-zinc-700/80 hover:border-zinc-500/80 focus-visible:ring-2 focus-visible:ring-zinc-400',
              className
            )}
          >
            <UserPlus className="h-3.5 w-3.5 text-zinc-200 stroke-[2.2]" />
            <span>{label}</span>
          </Button>
        ) : (
          <Button
            variant={variant}
            size={size}
            disabled={disabled}
            className={cn(
              'h-8 sm:h-9 font-semibold text-xs gap-1.5 shadow-2xs cursor-pointer',
              className
            )}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>{label}</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[490px] w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden p-5 sm:p-6 rounded-2xl border shadow-2xl">
        <DialogHeader className="space-y-1.5 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <UserPlus className="h-4 w-4" />
            </div>
            <DialogTitle className="text-base font-bold">Invite New User</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
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
