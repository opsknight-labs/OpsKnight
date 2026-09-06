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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Button } from '@/components/ui/shadcn/button';
import { UserPlus, Users } from 'lucide-react';
import TeamMemberForm from '@/components/TeamMemberForm';
import BulkTeamMemberActions from '@/components/BulkTeamMemberActions';

type User = {
  id: string;
  name: string;
  email: string;
  status?: string;
  avatarUrl?: string | null;
  gender?: string | null;
};

type TeamMemberAddModalProps = {
  teamId: string;
  availableUsers: User[];
  canManageMembers: boolean;
  canAssignOwnerAdmin: boolean;
  addMember: (teamId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
};

export default function TeamMemberAddModal({
  teamId,
  availableUsers,
  canManageMembers,
  canAssignOwnerAdmin,
  addMember,
}: TeamMemberAddModalProps) {
  const [open, setOpen] = useState(false);

  if (!canManageMembers) return null;

  const handleAddMember = async (formData: FormData) => {
    const res = await addMember(teamId, formData);
    if (!res?.error) {
      setOpen(false);
    }
    return res;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 h-8 text-xs font-medium shadow-2xs">
          <UserPlus className="h-3.5 w-3.5" />
          Add Member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Add Team Members
          </DialogTitle>
          <DialogDescription className="text-xs">
            Assign users and configure their role on this team.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="single" className="w-full mt-2">
          <TabsList className="grid w-full grid-cols-2 h-8.5 bg-muted/80">
            <TabsTrigger value="single" className="text-xs gap-1.5">
              <UserPlus className="h-3.5 w-3.5" /> Single User
            </TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs gap-1.5">
              <Users className="h-3.5 w-3.5" /> Bulk Add
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-4 focus-visible:outline-none">
            <TeamMemberForm
              teamId={teamId}
              availableUsers={availableUsers}
              canManageMembers={canManageMembers}
              canAssignOwnerAdmin={canAssignOwnerAdmin}
              addMember={handleAddMember}
            />
          </TabsContent>

          <TabsContent value="bulk" className="mt-4 focus-visible:outline-none">
            <BulkTeamMemberActions
              teamId={teamId}
              availableUsers={availableUsers}
              canManageMembers={canManageMembers}
              canAssignOwnerAdmin={canAssignOwnerAdmin}
              addMember={handleAddMember}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
