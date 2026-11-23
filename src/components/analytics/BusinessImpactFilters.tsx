'use client';

import { useRouter } from 'next/navigation';
import { FilterBar, FilterField } from '@/components/patterns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

type Params = { days: number; teamId: string | null; tier: string | null };

const TIERS = [
  ['TIER_0', 'Tier 0'],
  ['TIER_1', 'Tier 1'],
  ['TIER_2', 'Tier 2'],
  ['TIER_3', 'Tier 3'],
] as const;

/** Window, team and tier for the business impact report; state lives in the URL. */
export default function BusinessImpactFilters({
  params,
  teams,
}: {
  params: Params;
  teams: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const go = (next: Partial<Params>) => {
    const merged = { ...params, ...next };
    const search = new URLSearchParams();
    if (merged.days !== 30) search.set('days', String(merged.days));
    if (merged.teamId) search.set('team', merged.teamId);
    if (merged.tier) search.set('tier', merged.tier);
    const query = search.toString();
    router.replace(`/insights/business-impact${query ? `?${query}` : ''}`);
  };
  return (
    <FilterBar
      title="Filter the report"
      description="Pick a period, an owner team or a tier."
      filters={
        <>
          <FilterField label="Period" htmlFor="impact-days">
            <Select
              value={String(params.days)}
              onValueChange={value => go({ days: Number(value) })}
            >
              <SelectTrigger id="impact-days" className="h-9 w-[150px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Owner team" htmlFor="impact-team">
            <Select
              value={params.teamId ?? 'all'}
              onValueChange={value => go({ teamId: value === 'all' ? null : value })}
            >
              <SelectTrigger id="impact-team" className="h-9 w-[170px] text-sm">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Tier" htmlFor="impact-tier">
            <Select
              value={params.tier ?? 'all'}
              onValueChange={value => go({ tier: value === 'all' ? null : value })}
            >
              <SelectTrigger id="impact-tier" className="h-9 w-[130px] text-sm">
                <SelectValue placeholder="All tiers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                {TIERS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
      hasActiveFilters={params.days !== 30 || !!params.teamId || !!params.tier}
      onClearAll={() => router.replace('/insights/business-impact')}
    />
  );
}
