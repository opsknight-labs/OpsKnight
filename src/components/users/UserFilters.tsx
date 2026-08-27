'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Filter,
  X,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Search,
  Shield,
  Activity,
  Briefcase,
} from 'lucide-react';

type Team = {
  id: string;
  name: string;
};

type UserFiltersProps = {
  teams: Team[];
};

export default function UserFilters({ teams }: UserFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const query = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';
  const role = searchParams.get('role') || '';
  const teamId = searchParams.get('teamId') || '';

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      // Reset page when filtering
      if (name !== 'page') {
        params.delete('page');
      }
      return params.toString();
    },
    [searchParams]
  );

  const handleFilterChange = (name: string, value: string) => {
    startTransition(() => {
      router.push(`/users?${createQueryString(name, value)}`);
    });
  };

  const clearFilters = () => {
    startTransition(() => {
      router.push('/users');
    });
  };

  const hasFilters = !!query || !!status || !!role || !!teamId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filter Users
            </CardTitle>
            <CardDescription>Search and filter your team members</CardDescription>
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={clearFilters}
              disabled={isPending}
            >
              <X className="mr-1 h-3 w-3" /> Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Filters (Badges) */}
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={!status && !role && !teamId && !query ? 'default' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-primary/90 hover:text-primary-foreground transition-colors"
            onClick={() => clearFilters()}
          >
            All Users
          </Badge>
          <Badge
            variant={status === 'ACTIVE' ? 'success' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-green-100 hover:text-green-800 transition-colors"
            onClick={() => handleFilterChange('status', status === 'ACTIVE' ? '' : 'ACTIVE')}
          >
            <UserCheck className="mr-1 h-3 w-3" /> Active
          </Badge>
          <Badge
            variant={status === 'INVITED' ? 'warning' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-yellow-100 hover:text-yellow-800 transition-colors"
            onClick={() => handleFilterChange('status', status === 'INVITED' ? '' : 'INVITED')}
          >
            <UserPlus className="mr-1 h-3 w-3" /> Invited
          </Badge>
          <Badge
            variant={status === 'DISABLED' ? 'neutral' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-gray-100 hover:text-gray-800 transition-colors"
            onClick={() => handleFilterChange('status', status === 'DISABLED' ? '' : 'DISABLED')}
          >
            <UserX className="mr-1 h-3 w-3" /> Disabled
          </Badge>
          <Badge
            variant={role === 'ADMIN' ? 'danger' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-rose-100 hover:text-rose-800 transition-colors"
            onClick={() => handleFilterChange('role', role === 'ADMIN' ? '' : 'ADMIN')}
          >
            <Users className="mr-1 h-3 w-3" /> Admins
          </Badge>
        </div>

        {/* Filter Inputs grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label htmlFor="q" className="text-xs font-semibold uppercase text-muted-foreground">
              Search
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="q"
                placeholder="Name or email..."
                className="h-10 pl-9 bg-muted/30 focus:bg-background transition-colors"
                value={query}
                onChange={e => handleFilterChange('q', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Status</Label>
            <Select
              value={status}
              onValueChange={val => handleFilterChange('status', val === 'all' ? '' : val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All Statuses" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    <span>Active</span>
                  </div>
                </SelectItem>
                <SelectItem value="INVITED">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    <span>Invited</span>
                  </div>
                </SelectItem>
                <SelectItem value="DISABLED">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-500" />
                    <span>Disabled</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Role</Label>
            <Select
              value={role}
              onValueChange={val => handleFilterChange('role', val === 'all' ? '' : val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All Roles" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="ADMIN">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                    <span>Admin</span>
                  </div>
                </SelectItem>
                <SelectItem value="RESPONDER">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    <span>Responder</span>
                  </div>
                </SelectItem>
                <SelectItem value="AUDITOR">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span>Auditor</span>
                  </div>
                </SelectItem>
                <SelectItem value="USER">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                    <span>User</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Team</Label>
            <Select
              value={teamId}
              onValueChange={val => handleFilterChange('teamId', val === 'all' ? '' : val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All Teams" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
