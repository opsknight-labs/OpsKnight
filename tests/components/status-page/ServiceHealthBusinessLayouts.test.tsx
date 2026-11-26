import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ServiceHealthV3 from '@/components/status-page/v3/ServiceHealthV3';
import type {
  PublicBusinessService,
  PublicStatusService,
} from '@/lib/status-pages/public-contract';

const services: PublicStatusService[] = [
  { id: 'api', name: 'Payments API', status: 'MAJOR_OUTAGE', activeIncidentCount: 1 },
  { id: 'cdn', name: 'Edge CDN', status: 'OPERATIONAL', activeIncidentCount: 0 },
  { id: 'mail', name: 'Email delivery', status: 'OPERATIONAL', activeIncidentCount: 0 },
];
const businessServices: PublicBusinessService[] = [
  {
    id: 'checkout',
    name: 'Checkout',
    status: 'MAJOR_OUTAGE',
    memberServiceIds: ['api', 'cdn'],
    activeIncidentCount: 1,
    impactedServiceCount: 1,
  },
  {
    id: 'browse',
    name: 'Browsing',
    status: 'OPERATIONAL',
    memberServiceIds: ['cdn'],
    activeIncidentCount: 0,
    impactedServiceCount: 0,
  },
];

const renderLayout = (layout: 'FLAT' | 'BUSINESS' | 'BUSINESS_EXPANDABLE') =>
  render(
    <ServiceHealthV3
      services={services}
      businessServices={layout === 'FLAT' ? undefined : businessServices}
      layout={layout}
      timeZone="UTC"
      groupByRegion={false}
      showUptimeHistory={false}
      showMetrics={false}
      filterThreshold={0}
    />
  );

describe('ServiceHealthV3 business layouts', () => {
  it('FLAT keeps the original one-row-per-service list', () => {
    renderLayout('FLAT');
    expect(screen.getByText('Payments API')).toBeInTheDocument();
    expect(screen.queryByText('Checkout')).not.toBeInTheDocument();
    expect(screen.getByText('3 services')).toBeInTheDocument();
  });

  it('BUSINESS shows business rows with tallies and leftovers under Other services', () => {
    renderLayout('BUSINESS');
    const list = screen.getByRole('list', { name: 'Business services' });
    expect(within(list).getByText('Checkout')).toBeInTheDocument();
    expect(within(list).getByText('1 of 2 services affected')).toBeInTheDocument();
    expect(within(list).getByText('1 service')).toBeInTheDocument();
    expect(within(list).queryByText('Payments API')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Checkout/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Other services' })).toBeInTheDocument();
    expect(screen.getByText('Email delivery')).toBeInTheDocument();
    expect(screen.getByText('2 business services')).toBeInTheDocument();
  });

  it('BUSINESS_EXPANDABLE opens affected rows and toggles the rest with aria-expanded', () => {
    renderLayout('BUSINESS_EXPANDABLE');
    const checkout = screen.getByRole('button', { name: /Checkout/ });
    expect(checkout).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Services in Checkout' })).toBeVisible();
    expect(screen.getByText('Payments API')).toBeInTheDocument();

    const browsing = screen.getByRole('button', { name: /Browsing/ });
    expect(browsing).toHaveAttribute('aria-expanded', 'false');
    const panelId = browsing.getAttribute('aria-controls')!;
    expect(document.getElementById(panelId)).not.toBeVisible();
    fireEvent.click(browsing);
    expect(browsing).toHaveAttribute('aria-expanded', 'true');
    expect(within(document.getElementById(panelId)!).getByText('Edge CDN')).toBeInTheDocument();
  });

  it('search by a member service name reveals its business service', () => {
    renderLayout('BUSINESS_EXPANDABLE');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'edge' } });
    expect(screen.getByRole('button', { name: /Browsing/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('status filters apply to the business status', () => {
    renderLayout('BUSINESS');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Outage' }));
    const list = screen.getByRole('list', { name: 'Business services' });
    expect(within(list).getByText('Checkout')).toBeInTheDocument();
    expect(within(list).queryByText('Browsing')).not.toBeInTheDocument();
  });

  it('re-opens a row that becomes affected on a live refresh, even after the visitor closed it', () => {
    const props = {
      services,
      layout: 'BUSINESS_EXPANDABLE' as const,
      timeZone: 'UTC',
      groupByRegion: false,
      showUptimeHistory: false,
      showMetrics: false,
    };
    const { rerender } = render(<ServiceHealthV3 {...props} businessServices={businessServices} />);
    const browsing = screen.getByRole('button', { name: /Browsing/ });
    fireEvent.click(browsing);
    fireEvent.click(browsing);
    expect(browsing).toHaveAttribute('aria-expanded', 'false');
    rerender(
      <ServiceHealthV3
        {...props}
        businessServices={businessServices.map(item =>
          item.id === 'browse'
            ? { ...item, status: 'DEGRADED', statusSince: '2026-11-22T10:00:00.000Z' }
            : item
        )}
      />
    );
    expect(screen.getByRole('button', { name: /Browsing/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const since = document.querySelector('time[datetime="2026-11-22T10:00:00.000Z"]');
    expect(since?.parentElement?.textContent).toMatch(/since/);
  });

  it('keeps members out of view when the page hides them', () => {
    render(
      <ServiceHealthV3
        services={services}
        businessServices={[{ ...businessServices[0], showMembers: false }]}
        layout="BUSINESS_EXPANDABLE"
        timeZone="UTC"
        groupByRegion={false}
        showUptimeHistory={false}
        showMetrics={false}
      />
    );
    expect(screen.queryByRole('button', { name: /Checkout/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Services in Checkout' })).not.toBeInTheDocument();
  });
});

describe('ServiceHealthV3 business groups as dropdowns', () => {
  const base = {
    services,
    layout: 'BUSINESS_EXPANDABLE' as const,
    timeZone: 'UTC',
    groupByRegion: false,
    showUptimeHistory: false,
    showMetrics: false,
  };

  it('makes the "N services ›" count part of the disclosure button', () => {
    render(<ServiceHealthV3 {...base} businessServices={businessServices} />);
    const browsing = screen.getByRole('button', { name: /Browsing/ });
    const count = within(browsing).getByText('1 service');
    fireEvent.click(count);
    expect(browsing).toHaveAttribute('aria-expanded', 'true');
    expect(browsing.querySelector('.status-v3-business__chevron')).not.toBeNull();
  });

  it('counts members of a group that hides them', () => {
    render(
      <ServiceHealthV3
        {...base}
        businessServices={[
          {
            ...businessServices[0],
            showMembers: false,
            memberServiceIds: [],
            memberCount: 2,
          },
        ]}
      />
    );
    expect(screen.getByText('1 of 2 services affected')).toBeInTheDocument();
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });

  it('renders the section when only business rows exist', () => {
    render(
      <ServiceHealthV3
        {...base}
        services={[]}
        businessServices={[{ ...businessServices[1], memberServiceIds: [], memberCount: 4 }]}
      />
    );
    expect(screen.getByText('Browsing')).toBeInTheDocument();
    expect(screen.getByText('4 services')).toBeInTheDocument();
  });

  it('offers filters by visible row count, not service count, on grouped pages', () => {
    const groups = ['a', 'b', 'c'].map(id => ({
      ...businessServices[1],
      id,
      name: `Group ${id}`,
      memberServiceIds: [],
      memberCount: 1,
    }));
    render(
      <ServiceHealthV3 {...base} services={[]} businessServices={groups} filterThreshold={2} />
    );
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('starts every group open when the page expands groups by default', () => {
    render(<ServiceHealthV3 {...base} businessServices={businessServices} expandByDefault />);
    expect(screen.getByRole('button', { name: /Browsing/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('links the active incident count on a group row to the incidents section', () => {
    render(
      <ServiceHealthV3 {...base} businessServices={businessServices} incidentsHref="#incidents" />
    );
    expect(screen.getByRole('link', { name: '1 active incident' })).toHaveAttribute(
      'href',
      '#incidents'
    );
  });
});
