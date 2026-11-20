'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export default function UserSortDropdown() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSort = searchParams.get('sortBy') || 'createdAt';
  const currentOrder = searchParams.get('sortOrder') || 'desc';

  function handleSortChange(sort: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortBy', sort);
    // Reset to page 1 when changing sort
    params.delete('page');
    router.push(`/users?${params.toString()}`);
  }

  function handleOrderChange(order: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortOrder', order);
    router.push(`/users?${params.toString()}`);
  }

  const sortLabels = new Map([
    ['createdAt', 'Joined Date'],
    ['name', 'Name'],
    ['email', 'Email'],
    ['status', 'Status'],
    ['role', 'Role'],
  ]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs font-medium">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="hidden text-muted-foreground sm:inline">Sort:</span>
          {sortLabels.get(currentSort) ?? currentSort}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sort By</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currentSort} onValueChange={handleSortChange}>
          <DropdownMenuRadioItem value="createdAt">Joined Date</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="email">Email</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="role">Role</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Order</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={currentOrder} onValueChange={handleOrderChange}>
          <DropdownMenuRadioItem value="asc">
            <div className="flex items-center">
              <ArrowUp />
              Ascending
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">
            <div className="flex items-center">
              <ArrowDown />
              Descending
            </div>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
