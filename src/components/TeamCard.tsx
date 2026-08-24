'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ConfirmDialog from './ConfirmDialog';
import TeamMemberCard from './TeamMemberCard';
import TeamMemberSearch from './TeamMemberSearch';
import TeamActivityLog from './TeamActivityLog';
import BulkTeamMemberActions from './BulkTeamMemberActions';
import TeamStats from './TeamStats';
import TeamMemberForm from './TeamMemberForm';
import { useToast } from '@/hooks/use-product-notification';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
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
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit3,
  Users,
  Shield,
  Activity,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

type TeamCardProps = {
  team: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  teamId: string;
  ownerCount: number;
  adminCount: number;
  memberCount: number;
  availableUsers: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  activityLogs: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  activityTotal: number;
  canUpdateTeam: boolean;
  canDeleteTeam: boolean;
  canManageMembers: boolean;
  canManageNotifications: boolean;
  canAssignOwnerAdmin: boolean;
  updateTeam: (teamId: string, formData: FormData) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  deleteTeam: (teamId: string) => Promise<{ error?: string } | undefined>;
  addTeamMember: (teamId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  updateTeamMemberRole: (
    memberId: string,
    formData: FormData
  ) => Promise<{ error?: string } | undefined>;
  updateTeamMemberNotifications: (
    memberId: string,
    receiveNotifications: boolean
  ) => Promise<{ error?: string } | undefined>;
  removeTeamMember: (memberId: string) => Promise<{ error?: string } | undefined>;
};

export default function TeamCard({
  team,
  teamId,
  ownerCount,
  adminCount,
  memberCount,
  availableUsers,
  activityLogs,
  activityTotal,
  canUpdateTeam,
  canDeleteTeam,
  canManageMembers,
  canManageNotifications,
  canAssignOwnerAdmin,
  updateTeam,
  deleteTeam,
  addTeamMember,
  updateTeamMemberRole,
  updateTeamMemberNotifications,
  removeTeamMember,
}: TeamCardProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [filteredMembers, setFilteredMembers] = useState(team.members);
  const [activityPage, setActivityPage] = useState(1);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(true);
  const [isServicesOpen, setIsServicesOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    const result = await deleteTeam(teamId);
    if (result?.error) {
      showToast(result.error, 'error');
    } else {
      showToast('Team deleted successfully', 'success');
      router.refresh();
    }
  };

  const handleUpdateTeam = async (formData: FormData) => {
    const result = await updateTeam(teamId, formData);
    if (result?.error) {
      showToast(result.error, 'error');
    } else {
      showToast('Team updated successfully', 'success');
      setIsEditOpen(false);
      router.refresh();
    }
  };

  const handleAddMember = async (formData: FormData) => {
    return await addTeamMember(teamId, formData);
  };

  const activityTotalPages = Math.ceil(activityTotal / 5);

  return (
    <>
      <Card className="mb-6">
        {/* Team Header */}
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl">{team.name}</CardTitle>
                <Link href={`/users?teamId=${team.id}`}>
                  <Button variant="ghost" size="sm" className="h-7 gap-1">
                    <ExternalLink className="h-3 w-3" />
                    View Team
                  </Button>
                </Link>
              </div>
              <CardDescription className="text-base">
                {team.description || 'No description provided.'}
              </CardDescription>
              <div className="pt-2">
                <TeamStats
                  memberCount={memberCount}
                  serviceCount={team._count.services}
                  ownerCount={ownerCount}
                  adminCount={adminCount}
                />
              </div>
            </div>

            <div className="flex gap-2">
              {canUpdateTeam && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditOpen(!isEditOpen)}
                  className="gap-2"
                >
                  <Edit3 className="h-4 w-4" />
                  Edit Team
                </Button>
              )}
              {canDeleteTeam && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* Edit Team Form */}
          {isEditOpen && canUpdateTeam && (
            <Card className="bg-muted/50">
              <CardHeader>
                <CardTitle className="text-sm">Edit Team Details</CardTitle>
                <CardDescription className="text-xs">Update team information</CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  action={handleUpdateTeam}
                  className="space-y-4"
                  key={`team-form-${team.id}-${team.teamLeadId || 'none'}-${team.updatedAt || 'new'}`}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Team Name</Label>
                      <Input id="name" name="name" defaultValue={team.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Input
                        id="description"
                        name="description"
                        defaultValue={team.description || ''}
                        placeholder="Team mission"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="teamLeadId">
                      Team Lead <span className="text-xs text-muted-foreground">(Optional)</span>
                    </Label>
                    <select
                      id="teamLeadId"
                      name="teamLeadId"
                      defaultValue={team.teamLeadId || ''}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="">No team lead</option>
                      {team.members.map((member: any) => (
                        <option key={member.userId} value={member.userId}>
                          {member.user.name}{' '}
                          {member.role === 'OWNER'
                            ? '(Owner)'
                            : member.role === 'ADMIN'
                              ? '(Admin)'
                              : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Team lead can be notified separately in escalation policies
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Save Changes
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {!canUpdateTeam && isEditOpen && (
            <Card className="border-orange-200 bg-orange-50/50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-orange-900 mb-2">
                  <AlertTriangle className="h-5 w-5" />
                  <p className="text-sm font-medium">You don't have permission to edit this team</p>
                </div>
                <p className="text-xs text-orange-700">Admin or Responder role required.</p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Members Section */}
            <div className="xl:col-span-2 space-y-4">
              <Collapsible open={isMembersOpen} onOpenChange={setIsMembersOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Users className="h-5 w-5 text-primary" />
                          <CardTitle className="text-lg">Team Members</CardTitle>
                          <Badge variant="secondary" size="xs" className="ml-2">
                            {filteredMembers.length}
                          </Badge>
                        </div>
                        {isMembersOpen ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="space-y-4">
                      {team.members.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                          <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No members assigned to this team yet.</p>
                        </div>
                      ) : (
                        <>
                          <TeamMemberSearch
                            members={team.members}
                            onFilterChange={setFilteredMembers}
                          />
                          <div className="space-y-2">
                            {filteredMembers.map((member: any) => {
                              const handleUpdateRole = async (formData: FormData) => {
                                return await updateTeamMemberRole(member.id, formData);
                              };
                              const handleUpdateNotifications = async (
                                receiveNotifications: boolean
                              ) => {
                                return await updateTeamMemberNotifications(
                                  member.id,
                                  receiveNotifications
                                );
                              };
                              const handleRemove = async () => {
                                return await removeTeamMember(member.id);
                              };
                              const isSoleOwner = member.role === 'OWNER' && ownerCount === 1;

                              return (
                                <TeamMemberCard
                                  key={member.id}
                                  member={member}
                                  isSoleOwner={isSoleOwner}
                                  canManageMembers={canManageMembers}
                                  canManageNotifications={canManageNotifications}
                                  canAssignOwnerAdmin={canAssignOwnerAdmin}
                                  updateMemberRole={handleUpdateRole}
                                  updateMemberNotifications={handleUpdateNotifications}
                                  removeMember={handleRemove}
                                />
                              );
                            })}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Services Section */}
              <Collapsible open={isServicesOpen} onOpenChange={setIsServicesOpen}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          <CardTitle className="text-lg">Owned Services</CardTitle>
                          <Badge variant="secondary" size="xs" className="ml-2">
                            {team.services.length}
                          </Badge>
                        </div>
                        {isServicesOpen ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent>
                      {team.services.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                          <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No services assigned to this team yet.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {team.services.map((service: any) => (
                            <Link
                              key={service.id}
                              href={`/services/${service.id}`}
                              className="group"
                            >
                              <Card className="hover:bg-muted/50 hover:border-primary/50 transition-all cursor-pointer">
                                <CardContent className="p-3 flex items-center justify-between">
                                  <span className="text-sm font-medium truncate">
                                    {service.name}
                                  </span>
                                  <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 ml-2" />
                                </CardContent>
                              </Card>
                            </Link>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Activity Log */}
              {activityLogs.length > 0 && (
                <Collapsible open={isActivityOpen} onOpenChange={setIsActivityOpen}>
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Activity className="h-5 w-5 text-primary" />
                            <CardTitle className="text-lg">Activity Log</CardTitle>
                            <Badge variant="secondary" size="xs" className="ml-2">
                              {activityTotal}
                            </Badge>
                          </div>
                          {isActivityOpen ? (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <CardContent>
                        <TeamActivityLog
                          teamId={team.id}
                          logs={activityLogs}
                          totalLogs={activityTotal}
                          currentPage={activityPage}
                          totalPages={activityTotalPages}
                          onPageChange={page => {
                            setActivityPage(page);
                          }}
                        />
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              )}
            </div>

            {/* Sidebar - Add Members */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Add Member</CardTitle>
                  <CardDescription className="text-xs">Add users to this team</CardDescription>
                </CardHeader>
                <CardContent>
                  <TeamMemberForm
                    availableUsers={availableUsers}
                    canManageMembers={canManageMembers}
                    canAssignOwnerAdmin={canAssignOwnerAdmin}
                    addMember={handleAddMember}
                    teamId={team.id}
                  />
                </CardContent>
              </Card>

              {availableUsers.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Bulk Add Members</CardTitle>
                    <CardDescription className="text-xs">
                      Add multiple users at once
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <BulkTeamMemberActions
                      availableUsers={availableUsers}
                      canManageMembers={canManageMembers}
                      canAssignOwnerAdmin={canAssignOwnerAdmin}
                      addMember={handleAddMember}
                      teamId={team.id}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Team Permanently
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-destructive font-semibold">This action cannot be undone.</span>
              <br />
              <br />
              Are you sure you want to delete <strong>{team.name}</strong>? This will remove all
              team members and unassign all services.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete Team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
