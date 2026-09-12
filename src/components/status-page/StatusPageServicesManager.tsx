'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  X,
  Layers,
  Globe,
  CheckSquare,
  Square,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  SlidersHorizontal,
  Sparkles,
  ChevronLeft,
  ChevronsUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import Switch from '@/components/ui/Switch';
import FormField from '@/components/ui/FormField';

export interface ServiceItem {
  id: string;
  name: string;
  region?: string | null;
}

export interface ServiceConfigState {
  displayName: string;
  order: number;
  showOnPage: boolean;
}

interface StatusPageServicesManagerProps {
  allServices: ServiceItem[];
  selectedServices: Set<string>;
  setSelectedServices: React.Dispatch<React.SetStateAction<Set<string>>>;
  serviceConfigs: Record<string, ServiceConfigState>;
  updateServiceConfig: (serviceId: string, updates: Partial<ServiceConfigState>) => void;
  formData: {
    showServicesByRegion: boolean;
    showServiceOwners: boolean;
    showServiceSlaTier: boolean;
    [key: string]: any;
  };
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  privacySettings: {
    showServiceRegions?: boolean;
    showTeamInformation?: boolean;
    [key: string]: any;
  };
  hasSelectedRegions: boolean;
}

type FilterTab = 'all' | 'selected' | 'unselected' | 'visible' | 'hidden';
type DensityMode = 'table' | 'cards';

export default function StatusPageServicesManager({
  allServices,
  selectedServices,
  setSelectedServices,
  serviceConfigs,
  updateServiceConfig,
  formData,
  setFormData,
  privacySettings,
  hasSelectedRegions,
}: StatusPageServicesManagerProps) {
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('ALL');
  const [groupByRegion, setGroupByRegion] = useState(false);
  const [densityMode, setDensityMode] = useState<DensityMode>('table');
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set());

  // Pagination State
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Extract all unique regions
  const uniqueRegions = useMemo(() => {
    const set = new Set<string>();
    allServices.forEach(s => {
      if (s.region?.trim()) set.add(s.region.trim());
    });
    return Array.from(set).sort();
  }, [allServices]);

  // Filtered Services List
  const filteredServices = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return allServices.filter(service => {
      // 1. Search Query
      if (q) {
        const matchesName = service.name.toLowerCase().includes(q);
        const matchesRegion = service.region?.toLowerCase().includes(q) || false;
        const config = serviceConfigs[service.id];
        const matchesDisplay = config?.displayName?.toLowerCase().includes(q) || false;
        if (!matchesName && !matchesRegion && !matchesDisplay) {
          return false;
        }
      }

      // 2. Region Dropdown Filter
      if (selectedRegionFilter !== 'ALL') {
        if (selectedRegionFilter === 'NO_REGION') {
          if (service.region?.trim()) return false;
        } else if (service.region !== selectedRegionFilter) {
          return false;
        }
      }

      // 3. Status Filter Tabs
      const isSelected = selectedServices.has(service.id);
      const isVisible = isSelected && serviceConfigs[service.id]?.showOnPage !== false;

      if (filterTab === 'selected' && !isSelected) return false;
      if (filterTab === 'unselected' && isSelected) return false;
      if (filterTab === 'visible' && !isVisible) return false;
      if (filterTab === 'hidden' && (!isSelected || isVisible)) return false;

      return true;
    });
  }, [allServices, searchQuery, selectedRegionFilter, filterTab, selectedServices, serviceConfigs]);

  // Metric Counts
  const selectedCount = selectedServices.size;
  const unselectedCount = allServices.length - selectedCount;
  const visibleCount = useMemo(() => {
    let count = 0;
    selectedServices.forEach(id => {
      if (serviceConfigs[id]?.showOnPage !== false) count++;
    });
    return count;
  }, [selectedServices, serviceConfigs]);
  const hiddenCount = selectedCount - visibleCount;

  // Pagination calculations
  const totalItems = filteredServices.length;
  const totalPages = pageSize === -1 ? 1 : Math.ceil(totalItems / pageSize) || 1;
  const validPage = Math.min(currentPage, totalPages);

  const paginatedServices = useMemo(() => {
    if (pageSize === -1) return filteredServices;
    const start = (validPage - 1) * pageSize;
    return filteredServices.slice(start, start + pageSize);
  }, [filteredServices, validPage, pageSize]);

  // Grouped by Region Map
  const servicesByRegion = useMemo(() => {
    const map: Record<string, ServiceItem[]> = {};
    paginatedServices.forEach(service => {
      const reg = service.region?.trim() || 'Global / Unassigned';
      if (!map[reg]) map[reg] = [];
      map[reg].push(service);
    });
    return map;
  }, [paginatedServices]);

  // --- BULK ACTION HANDLERS ---

  const handleSelectFiltered = () => {
    const next = new Set(selectedServices);
    filteredServices.forEach(s => {
      next.add(s.id);
      if (!serviceConfigs[s.id]) {
        updateServiceConfig(s.id, {
          displayName: '',
          order: 0,
          showOnPage: true,
        });
      }
    });
    setSelectedServices(next);
  };

  const handleDeselectFiltered = () => {
    const next = new Set(selectedServices);
    filteredServices.forEach(s => next.delete(s.id));
    setSelectedServices(next);
  };

  const handleSetFilteredVisible = (showOnPage: boolean) => {
    filteredServices.forEach(s => {
      if (selectedServices.has(s.id)) {
        updateServiceConfig(s.id, { showOnPage });
      }
    });
  };

  const handleAutoOrderAlphabetical = () => {
    // Sort selected services alphabetically and assign orders 10, 20, 30...
    const selectedList = allServices
      .filter(s => selectedServices.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    selectedList.forEach((s, idx) => {
      updateServiceConfig(s.id, { order: (idx + 1) * 10 });
    });
  };

  const toggleRegionCollapse = (region: string) => {
    setCollapsedRegions(prev => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  const handleToggleRegionSelection = (region: string, select: boolean) => {
    const servicesInReg = allServices.filter(
      s => (s.region?.trim() || 'Global / Unassigned') === region
    );
    const next = new Set(selectedServices);
    servicesInReg.forEach(s => {
      if (select) {
        next.add(s.id);
        if (!serviceConfigs[s.id]) {
          updateServiceConfig(s.id, {
            displayName: '',
            order: 0,
            showOnPage: true,
          });
        }
      } else {
        next.delete(s.id);
      }
    });
    setSelectedServices(next);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Global Public Settings Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl border border-border/80 bg-card hover:bg-muted/10 transition-colors shadow-2xs">
          <Switch
            checked={formData.showServicesByRegion}
            onChange={checked => setFormData({ ...formData, showServicesByRegion: checked })}
            label="Group by Region"
            helperText={
              privacySettings.showServiceRegions === false
                ? 'Enable “Show Service Regions” in Privacy settings.'
                : hasSelectedRegions
                  ? 'Group services under regional headings for visitors.'
                  : 'Add regions to selected services to enable.'
            }
            disabled={privacySettings.showServiceRegions === false || !hasSelectedRegions}
          />
        </div>

        <div className="p-3.5 rounded-xl border border-border/80 bg-card hover:bg-muted/10 transition-colors shadow-2xs">
          <Switch
            checked={formData.showServiceOwners}
            onChange={checked => setFormData({ ...formData, showServiceOwners: checked })}
            label="Show Service Owners"
            helperText={
              privacySettings.showTeamInformation === false
                ? 'Enable “Show Team Information” in Privacy.'
                : 'Display “Owned by <team>” badges on public page.'
            }
            disabled={privacySettings.showTeamInformation === false}
          />
        </div>

        <div className="p-3.5 rounded-xl border border-border/80 bg-card hover:bg-muted/10 transition-colors shadow-2xs">
          <Switch
            checked={formData.showServiceSlaTier}
            onChange={checked => setFormData({ ...formData, showServiceSlaTier: checked })}
            label="Show SLA Tier"
            helperText="Display SLA tier badges (e.g. Critical, Standard) to visitors."
          />
        </div>
      </div>

      {/* 2. Search, Filters, View Density & Grouping Toolbar */}
      <div className="flex flex-col gap-3.5 p-4 rounded-xl border border-border/80 bg-card shadow-2xs">
        {/* Row 1: Search & Region Dropdown & Layout Controls */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              className="w-full pl-9 pr-8 py-2 text-sm bg-background border border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              placeholder={`Search ${allServices.length} services by name or region...`}
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Region Dropdown & View Mode Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Region Filter */}
            {uniqueRegions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={selectedRegionFilter}
                  onChange={e => {
                    setSelectedRegionFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="ALL">All Regions ({allServices.length})</option>
                  {uniqueRegions.map(reg => (
                    <option key={reg} value={reg}>
                      {reg} ({allServices.filter(s => s.region === reg).length})
                    </option>
                  ))}
                  <option value="NO_REGION">
                    Unassigned ({allServices.filter(s => !s.region?.trim()).length})
                  </option>
                </select>
              </div>
            )}

            {/* Group by Region Accordion Toggle */}
            <button
              type="button"
              onClick={() => setGroupByRegion(prev => !prev)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all',
                groupByRegion
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
              title="Organize services into collapsible region sections"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Group by Region</span>
            </button>

            {/* Density Toggle: Table vs Cards */}
            <div className="inline-flex items-center bg-muted/60 p-1 rounded-lg border border-border/80 text-xs font-medium">
              <button
                type="button"
                onClick={() => setDensityMode('table')}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all',
                  densityMode === 'table'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title="Compact Table View"
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setDensityMode('cards')}
                className={cn(
                  'px-2.5 py-1 rounded-md transition-all',
                  densityMode === 'cards'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                title="Detailed Cards View"
              >
                Cards
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Status Filter Pills */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-border/50">
          <div className="inline-flex items-center gap-1 flex-wrap text-xs">
            <button
              type="button"
              onClick={() => {
                setFilterTab('all');
                setCurrentPage(1);
              }}
              className={cn(
                'px-2.5 py-1 rounded-lg font-medium transition-colors',
                filterTab === 'all'
                  ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              All ({allServices.length})
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterTab('selected');
                setCurrentPage(1);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors',
                filterTab === 'selected'
                  ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Selected ({selectedCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterTab('unselected');
                setCurrentPage(1);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors',
                filterTab === 'unselected'
                  ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <Square className="w-3.5 h-3.5" />
              Unselected ({unselectedCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterTab('visible');
                setCurrentPage(1);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors',
                filterTab === 'visible'
                  ? 'bg-emerald-600 text-white font-semibold shadow-2xs'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <Eye className="w-3.5 h-3.5" />
              Visible on Page ({visibleCount})
            </button>

            <button
              type="button"
              onClick={() => {
                setFilterTab('hidden');
                setCurrentPage(1);
              }}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition-colors',
                filterTab === 'hidden'
                  ? 'bg-amber-600 text-white font-semibold shadow-2xs'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <EyeOff className="w-3.5 h-3.5" />
              Hidden ({hiddenCount})
            </button>
          </div>

          {/* Quick Info */}
          <div className="text-xs text-muted-foreground self-center">
            <span>
              Showing <strong className="text-foreground">{filteredServices.length}</strong> of{' '}
              <strong className="text-foreground">{allServices.length}</strong> services
            </span>
          </div>
        </div>

        {/* Row 3: Bulk Actions Strip */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-border/40 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">
              Bulk Actions:
            </span>

            <button
              type="button"
              onClick={handleSelectFiltered}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-foreground border border-border/60 transition-colors font-medium"
              title="Select all currently filtered services"
            >
              <CheckSquare className="w-3.5 h-3.5 text-primary" />
              Select All ({filteredServices.length})
            </button>

            <button
              type="button"
              onClick={handleDeselectFiltered}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-foreground border border-border/60 transition-colors font-medium"
              title="Deselect all currently filtered services"
            >
              <Square className="w-3.5 h-3.5 text-muted-foreground" />
              Deselect All
            </button>

            <button
              type="button"
              onClick={() => handleSetFilteredVisible(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-foreground border border-border/60 transition-colors font-medium"
              title="Set Show on Page to true for all selected in this view"
            >
              <Eye className="w-3.5 h-3.5 text-emerald-600" />
              Show All Selected
            </button>

            <button
              type="button"
              onClick={() => handleSetFilteredVisible(false)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-foreground border border-border/60 transition-colors font-medium"
              title="Set Show on Page to false for all selected in this view"
            >
              <EyeOff className="w-3.5 h-3.5 text-amber-600" />
              Hide All Selected
            </button>
          </div>

          <button
            type="button"
            onClick={handleAutoOrderAlphabetical}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors font-semibold"
            title="Automatically assign sequential orders (10, 20, 30...) to selected services based on alphabetical order"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-Order (A-Z)
          </button>
        </div>
      </div>

      {/* 3. Empty State */}
      {filteredServices.length === 0 && (
        <div className="py-12 px-4 text-center rounded-xl border border-dashed border-border/80 bg-muted/20">
          <Layers className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
          <h4 className="text-sm font-semibold text-foreground">No matching services found</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No services match "${searchQuery}". Try clearing your search query or adjusting your filters.`
              : 'No services match the active status or region filter.'}
          </p>
          {(searchQuery || filterTab !== 'all' || selectedRegionFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterTab('all');
                setSelectedRegionFilter('ALL');
                setCurrentPage(1);
              }}
              className="mt-3.5 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-2xs"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* 4. Services List / Table Rendering */}
      {filteredServices.length > 0 && (
        <div className="space-y-4">
          {/* GROUPED ACCORDION VIEW */}
          {groupByRegion ? (
            <div className="space-y-3">
              {Object.entries(servicesByRegion).map(([region, services]) => {
                const isCollapsed = collapsedRegions.has(region);
                const regSelectedCount = services.filter(s => selectedServices.has(s.id)).length;

                return (
                  <div
                    key={region}
                    className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-2xs transition-all"
                  >
                    {/* Region Group Header */}
                    <div className="p-3 bg-muted/40 border-b border-border/60 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => toggleRegionCollapse(region)}
                        className="flex items-center gap-2 text-left flex-1 hover:opacity-80 transition-opacity"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                        <Globe className="w-4 h-4 text-primary" />
                        <span className="font-bold text-sm text-foreground">{region}</span>
                        <Badge variant="neutral" size="xs" className="font-semibold">
                          {services.length} {services.length === 1 ? 'service' : 'services'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          ({regSelectedCount} included)
                        </span>
                      </button>

                      {/* Quick Region Select / Deselect */}
                      <div className="flex items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => handleToggleRegionSelection(region, true)}
                          className="px-2 py-0.5 rounded bg-background hover:bg-muted border border-border/60 text-muted-foreground hover:text-foreground transition-colors font-medium text-[11px]"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleRegionSelection(region, false)}
                          className="px-2 py-0.5 rounded bg-background hover:bg-muted border border-border/60 text-muted-foreground hover:text-foreground transition-colors font-medium text-[11px]"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    {/* Region Services Content */}
                    {!isCollapsed && (
                      <div className="p-2 sm:p-3">
                        {densityMode === 'table' ? (
                          <ServicesTableView
                            services={services}
                            selectedServices={selectedServices}
                            setSelectedServices={setSelectedServices}
                            serviceConfigs={serviceConfigs}
                            updateServiceConfig={updateServiceConfig}
                          />
                        ) : (
                          <ServicesCardView
                            services={services}
                            selectedServices={selectedServices}
                            setSelectedServices={setSelectedServices}
                            serviceConfigs={serviceConfigs}
                            updateServiceConfig={updateServiceConfig}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* FLAT LIST VIEW */
            <div>
              {densityMode === 'table' ? (
                <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-2xs">
                  <ServicesTableView
                    services={paginatedServices}
                    selectedServices={selectedServices}
                    setSelectedServices={setSelectedServices}
                    serviceConfigs={serviceConfigs}
                    updateServiceConfig={updateServiceConfig}
                  />
                </div>
              ) : (
                <ServicesCardView
                  services={paginatedServices}
                  selectedServices={selectedServices}
                  setSelectedServices={setSelectedServices}
                  serviceConfigs={serviceConfigs}
                  updateServiceConfig={updateServiceConfig}
                />
              )}
            </div>
          )}

          {/* 5. Pagination Controls Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 rounded-xl border border-border/80 bg-card text-xs text-muted-foreground shadow-2xs">
            <div className="flex items-center gap-3">
              <span>
                Showing{' '}
                <strong className="text-foreground">
                  {pageSize === -1 ? 1 : Math.min((validPage - 1) * pageSize + 1, totalItems)}
                </strong>{' '}
                to{' '}
                <strong className="text-foreground">
                  {pageSize === -1 ? totalItems : Math.min(validPage * pageSize, totalItems)}
                </strong>{' '}
                of <strong className="text-foreground">{totalItems}</strong> services
              </span>

              <div className="flex items-center gap-1.5 border-l border-border/80 pl-3">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-background border border-border/80 rounded px-2 py-0.5 text-xs text-foreground font-medium focus:outline-none"
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={-1}>All ({allServices.length})</option>
                </select>
              </div>
            </div>

            {/* Next / Prev Controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <span className="mr-1">
                  Page <strong>{validPage}</strong> of <strong>{totalPages}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={validPage <= 1}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border/80 bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={validPage >= totalPages}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border/80 bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- SUBCOMPONENT: HIGH-DENSITY TABLE VIEW ---
function ServicesTableView({
  services,
  selectedServices,
  setSelectedServices,
  serviceConfigs,
  updateServiceConfig,
}: {
  services: ServiceItem[];
  selectedServices: Set<string>;
  setSelectedServices: React.Dispatch<React.SetStateAction<Set<string>>>;
  serviceConfigs: Record<string, ServiceConfigState>;
  updateServiceConfig: (serviceId: string, updates: Partial<ServiceConfigState>) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="border-b border-border/80 bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            <th className="py-2.5 px-3.5 w-10">Include</th>
            <th className="py-2.5 px-3.5">Service Name</th>
            <th className="py-2.5 px-3.5">Region</th>
            <th className="py-2.5 px-3.5">Display Name Override</th>
            <th className="py-2.5 px-3.5 w-24">Order</th>
            <th className="py-2.5 px-3.5 w-32 text-right">Visibility</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {services.map(service => {
            const isSelected = selectedServices.has(service.id);
            const config = serviceConfigs[service.id] || {
              displayName: '',
              order: 0,
              showOnPage: true,
            };

            const handleToggleService = (select: boolean) => {
              const next = new Set(selectedServices);
              if (select) {
                next.add(service.id);
                if (!serviceConfigs[service.id]) {
                  updateServiceConfig(service.id, {
                    displayName: '',
                    order: 0,
                    showOnPage: true,
                  });
                }
              } else {
                next.delete(service.id);
              }
              setSelectedServices(next);
            };

            return (
              <tr
                key={service.id}
                className={cn(
                  'transition-colors duration-100',
                  isSelected
                    ? 'bg-primary/5 hover:bg-primary/10'
                    : 'bg-card hover:bg-muted/30 opacity-70 hover:opacity-100'
                )}
              >
                {/* Selection Checkbox */}
                <td className="py-2.5 px-3.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={e => handleToggleService(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4 transition-colors cursor-pointer"
                    aria-label={`Include ${service.name}`}
                  />
                </td>

                {/* Service Name */}
                <td className="py-2.5 px-3.5 font-semibold text-foreground">
                  <div
                    onClick={() => handleToggleService(!isSelected)}
                    className="flex items-center gap-2 cursor-pointer select-none inline-flex"
                    title={isSelected ? 'Click to deselect' : 'Click to select and configure'}
                  >
                    <span className="hover:text-primary transition-colors">{service.name}</span>
                    {isSelected && (
                      <Badge variant="success" size="xs" className="text-[10px] font-bold">
                        Active
                      </Badge>
                    )}
                  </div>
                </td>

                {/* Region Badge */}
                <td className="py-2.5 px-3.5 text-xs text-muted-foreground whitespace-nowrap">
                  {service.region ? (
                    <Badge variant="neutral" size="xs" className="gap-1 font-mono">
                      <Globe className="w-3 h-3 text-muted-foreground" />
                      {service.region}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/50 italic text-[11px]">
                      Global / None
                    </span>
                  )}
                </td>

                {/* Display Name Override Input */}
                <td className="py-2.5 px-3.5">
                  {isSelected ? (
                    <input
                      type="text"
                      value={config.displayName}
                      onChange={e =>
                        updateServiceConfig(service.id, { displayName: e.target.value })
                      }
                      placeholder={service.name}
                      className="w-full max-w-xs px-2.5 py-1 text-xs bg-background border border-border/80 rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleService(true)}
                      className="text-xs text-muted-foreground/70 hover:text-primary transition-colors inline-flex items-center gap-1.5 py-0.5 px-2 rounded-md hover:bg-primary/10 border border-transparent hover:border-primary/20 cursor-pointer group"
                      title="Select checkbox and configure this service"
                    >
                      <span className="underline decoration-dotted underline-offset-2 group-hover:no-underline">
                        Click to configure
                      </span>
                    </button>
                  )}
                </td>

                {/* Display Order */}
                <td className="py-2.5 px-3.5">
                  {isSelected ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={config.order}
                        onChange={e =>
                          updateServiceConfig(service.id, {
                            order: parseInt(e.target.value) || 0,
                          })
                        }
                        className="w-16 px-2 py-1 text-xs bg-background border border-border/80 rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleService(true)}
                      className="text-muted-foreground/40 hover:text-foreground text-xs cursor-pointer px-1 py-0.5"
                      title="Click to configure order"
                    >
                      -
                    </button>
                  )}
                </td>

                {/* Show on Page Switch */}
                <td className="py-2.5 px-3.5 text-right">
                  {isSelected ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          updateServiceConfig(service.id, { showOnPage: !config.showOnPage })
                        }
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border transition-all',
                          config.showOnPage
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                        )}
                        title={config.showOnPage ? 'Visible to public' : 'Hidden from public'}
                      >
                        {config.showOnPage ? (
                          <>
                            <Eye className="w-3 h-3" />
                            <span>Visible</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3" />
                            <span>Hidden</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleToggleService(true)}
                      className="text-xs text-muted-foreground/50 hover:text-primary transition-colors italic hover:not-italic cursor-pointer"
                      title="Click to select and include on status page"
                    >
                      Excluded (click to configure)
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- SUBCOMPONENT: DETAILED CARDS VIEW ---
function ServicesCardView({
  services,
  selectedServices,
  setSelectedServices,
  serviceConfigs,
  updateServiceConfig,
}: {
  services: ServiceItem[];
  selectedServices: Set<string>;
  setSelectedServices: React.Dispatch<React.SetStateAction<Set<string>>>;
  serviceConfigs: Record<string, ServiceConfigState>;
  updateServiceConfig: (serviceId: string, updates: Partial<ServiceConfigState>) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {services.map(service => {
        const isSelected = selectedServices.has(service.id);
        const config = serviceConfigs[service.id] || {
          displayName: '',
          order: 0,
          showOnPage: true,
        };

        return (
          <div
            key={service.id}
            className={cn(
              'rounded-xl border transition-all p-4',
              isSelected
                ? 'border-primary/40 bg-primary/5 shadow-2xs'
                : 'border-border/80 bg-card hover:border-border opacity-80 hover:opacity-100'
            )}
          >
            {/* Card Header: Checkbox + Name + Region */}
            <div className="flex items-center justify-between gap-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={e => {
                    const next = new Set(selectedServices);
                    if (e.target.checked) {
                      next.add(service.id);
                      if (!serviceConfigs[service.id]) {
                        updateServiceConfig(service.id, {
                          displayName: '',
                          order: 0,
                          showOnPage: true,
                        });
                      }
                    } else {
                      next.delete(service.id);
                    }
                    setSelectedServices(next);
                  }}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4 transition-colors cursor-pointer"
                />
                <span className="font-bold text-sm text-foreground truncate" title={service.name}>
                  {service.name}
                </span>
              </label>

              {service.region && (
                <Badge variant="neutral" size="xs" className="font-mono text-[10px] shrink-0">
                  {service.region}
                </Badge>
              )}
            </div>

            {/* Card Overrides (Only shown if service is selected) */}
            {isSelected && (
              <div className="mt-3.5 pt-3.5 border-t border-border/60 space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-center">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Display Name Override
                    </label>
                    <input
                      type="text"
                      value={config.displayName}
                      onChange={e =>
                        updateServiceConfig(service.id, { displayName: e.target.value })
                      }
                      placeholder={service.name}
                      className="w-full px-2.5 py-1 text-xs bg-background border border-border/80 rounded-md placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      Display Order
                    </label>
                    <input
                      type="number"
                      value={config.order}
                      onChange={e =>
                        updateServiceConfig(service.id, {
                          order: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-full px-2.5 py-1 text-xs bg-background border border-border/80 rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">Visible on Public Status Page</span>
                  <Switch
                    checked={config.showOnPage}
                    onChange={checked => updateServiceConfig(service.id, { showOnPage: checked })}
                    size="sm"
                  />
                </div>
              </div>
            )}

            {/* Card Footer when NOT selected */}
            {!isSelected && (
              <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between text-xs">
                <span className="text-muted-foreground/50 italic text-[11px]">Not displayed</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedServices);
                    next.add(service.id);
                    if (!serviceConfigs[service.id]) {
                      updateServiceConfig(service.id, {
                        displayName: '',
                        order: 0,
                        showOnPage: true,
                      });
                    }
                    setSelectedServices(next);
                  }}
                  className="text-xs text-primary font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  Click to configure
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
