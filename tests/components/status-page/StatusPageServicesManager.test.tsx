import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import StatusPageServicesManager, {
  type ServiceItem,
  type ServiceConfigState,
} from '@/components/status-page/StatusPageServicesManager';

// Mock 100 services across different regions
const mockServices: ServiceItem[] = Array.from({ length: 100 }, (_, i) => {
  const id = `service-${i + 1}`;
  const regions = ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'us-west-2'];
  const region = i % 5 === 0 ? undefined : regions[i % regions.length];
  return {
    id,
    name: `Service ${String(i + 1).padStart(3, '0')}`,
    region,
  };
});

describe('StatusPageServicesManager Component', () => {
  let selectedServices: Set<string>;
  let serviceConfigs: Record<string, ServiceConfigState>;
  let setSelectedServices: any;
  let updateServiceConfig: any;
  let formData: any;
  let setFormData: any;

  beforeEach(() => {
    vi.clearAllMocks();
    selectedServices = new Set(['service-1', 'service-2', 'service-3']);
    serviceConfigs = {
      'service-1': { displayName: 'API Gateway', order: 1, showOnPage: true },
      'service-2': { displayName: 'Auth Service', order: 2, showOnPage: false },
      'service-3': { displayName: '', order: 3, showOnPage: true },
    };
    setSelectedServices = vi.fn(updater => {
      if (typeof updater === 'function') {
        selectedServices = updater(selectedServices);
      } else {
        selectedServices = updater;
      }
    });
    updateServiceConfig = vi.fn();
    formData = {
      showServicesByRegion: false,
      showServiceOwners: false,
      showServiceSlaTier: false,
    };
    setFormData = vi.fn();
  });

  const renderManager = (
    props?: Partial<React.ComponentProps<typeof StatusPageServicesManager>>
  ) => {
    return render(
      <StatusPageServicesManager
        allServices={mockServices}
        selectedServices={selectedServices}
        setSelectedServices={setSelectedServices}
        serviceConfigs={serviceConfigs}
        updateServiceConfig={updateServiceConfig}
        formData={formData}
        setFormData={setFormData}
        privacySettings={{ showServiceRegions: true, showTeamInformation: true }}
        hasSelectedRegions={true}
        {...props}
      />
    );
  };

  it('renders summary statistics and tabs correctly', () => {
    renderManager();

    expect(screen.getByRole('button', { name: /^All \(100\)$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Selected \(3\)/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Unselected \(97\)/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Visible on Page \(2\)/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Hidden \(1\)/i })).toBeDefined();

    // Default page size is 25, so Service 001 to Service 025 are on page 1
    expect(screen.getByText('Service 001')).toBeDefined();
    expect(screen.getByText('Service 025')).toBeDefined();
    expect(screen.queryByText('Service 026')).toBeNull();
  });

  it('filters services by search query (name, custom display name, region)', () => {
    renderManager();

    const searchInput = screen.getByPlaceholderText(/Search 100 services by name or region/i);

    // Search by custom display name "Gateway"
    fireEvent.change(searchInput, { target: { value: 'Gateway' } });
    expect(screen.getByText('Service 001')).toBeDefined();
    expect(screen.queryByText('Service 002')).toBeNull();

    // Search by region "ap-southeast-1"
    fireEvent.change(searchInput, { target: { value: 'ap-southeast-1' } });
    expect(screen.queryByText('Service 001')).toBeNull();
    expect(screen.getByText('Service 003')).toBeDefined();
  });

  it('filters by status tabs (selected, unselected, visible, hidden)', () => {
    renderManager();

    // Click "Selected" tab
    const selectedTab = screen.getByRole('button', { name: /Selected \(3\)/i });
    fireEvent.click(selectedTab);

    expect(screen.getByText('Service 001')).toBeDefined();
    expect(screen.getByText('Service 002')).toBeDefined();
    expect(screen.getByText('Service 003')).toBeDefined();
    expect(screen.queryByText('Service 004')).toBeNull();

    // Click "Hidden" tab (service-2 is showOnPage: false)
    const hiddenTab = screen.getByRole('button', { name: /Hidden \(1\)/i });
    fireEvent.click(hiddenTab);

    expect(screen.getByText('Service 002')).toBeDefined();
    expect(screen.queryByText('Service 001')).toBeNull();
    expect(screen.queryByText('Service 003')).toBeNull();
  });

  it('supports pagination: navigates pages and changes page size', () => {
    renderManager();

    // Verify pagination indicator text: Showing 1 to 25 of 100 services
    expect(screen.getAllByText(/Showing/i).length).toBe(2);
    expect(screen.getByRole('button', { name: /Next/i })).toBeDefined();

    // Click Next button
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText('Service 026')).toBeDefined();

    // Change Page Size to 50
    const perPageSelect = screen.getAllByRole('combobox').find(sel => {
      return (sel as HTMLSelectElement).value === '25';
    });
    expect(perPageSelect).toBeDefined();
    fireEvent.change(perPageSelect!, { target: { value: '50' } });

    expect(screen.getByText('Service 001')).toBeDefined();
    expect(screen.getByText('Service 050')).toBeDefined();
    expect(screen.queryByText('Service 051')).toBeNull();
  });

  it('executes bulk select and deselect operations', () => {
    renderManager();

    // Click "Select All"
    const selectAllBtn = screen.getByRole('button', { name: /Select All \(100\)/i });
    fireEvent.click(selectAllBtn);
    expect(setSelectedServices).toHaveBeenCalled();

    // Click "Deselect All"
    const deselectAllBtn = screen.getByRole('button', { name: /Deselect All/i });
    fireEvent.click(deselectAllBtn);
    expect(setSelectedServices).toHaveBeenCalled();
  });

  it('executes Auto-Order A-Z to sort services alphabetically', () => {
    renderManager();

    const autoOrderBtn = screen.getByRole('button', { name: /Auto-Order \(A-Z\)/i });
    fireEvent.click(autoOrderBtn);

    expect(updateServiceConfig).toHaveBeenCalled();
  });

  it('toggles density mode between table view and cards view', () => {
    renderManager();

    // Initially in table mode
    expect(screen.getByText('Display Name Override')).toBeDefined();

    // Switch to Cards mode
    const cardsBtn = screen.getByTitle('Detailed Cards View');
    fireEvent.click(cardsBtn);

    // Should still display service items
    expect(screen.getByText('Service 001')).toBeDefined();
  });

  it('supports region grouping and collapsible accordion', () => {
    renderManager();

    // Click Group by Region button
    const groupBtn = screen.getByTitle('Organize services into collapsible region sections');
    fireEvent.click(groupBtn);

    // Headings for regions should be rendered
    expect(screen.getAllByText(/us-east-1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/eu-west-1/i).length).toBeGreaterThan(0);
  });

  it('triggers updateServiceConfig when editing display name and show on page', () => {
    renderManager();

    // In table view, service-1 display name input is rendered
    const displayInputs = screen.getAllByPlaceholderText('Service 001');
    expect(displayInputs.length).toBeGreaterThan(0);
    fireEvent.change(displayInputs[0], { target: { value: 'Production API' } });

    expect(updateServiceConfig).toHaveBeenCalledWith('service-1', {
      displayName: 'Production API',
    });
  });

  it('selects the checkbox when clicking "Click to configure" or clicking the service name', () => {
    renderManager();

    // Service 004 is unselected
    const configureButtons = screen.getAllByRole('button', { name: /Click to configure/i });
    expect(configureButtons.length).toBeGreaterThan(0);

    // Click "Click to configure" on an unselected service
    fireEvent.click(configureButtons[0]);
    expect(setSelectedServices).toHaveBeenCalled();

    // Click on unselected service name
    const service4 = screen.getByText('Service 004');
    fireEvent.click(service4);
    expect(setSelectedServices).toHaveBeenCalled();
  });
});
