'use client';

import FilterChips from './FilterChips';

interface AnalyticsFiltersClientProps {
    teams: Array<{ id: string; name: string }>;
    services: Array<{ id: string; name: string }>;
    users: Array<{ id: string; name: string | null; email: string | null }>;
    currentFilters: {
        team?: string;
        service?: string;
        assignee?: string;
        status?: string;
        urgency?: string;
        window?: string;
    };
}

export default function AnalyticsFiltersClient({
    teams,
    services,
    users,
    currentFilters
}: AnalyticsFiltersClientProps) {
    return (
        <FilterChips
            filters={currentFilters}
            teams={teams}
            services={services}
            users={users}
        />
    );
}

