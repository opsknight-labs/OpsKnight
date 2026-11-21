import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import IncidentListBadges from '@/components/incident/intelligence/IncidentListBadges';

describe('IncidentListBadges', () => {
  it('renders nothing without badges', () => {
    const { container } = render(<IncidentListBadges badges={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: none } = render(<IncidentListBadges />);
    expect(none).toBeEmptyDOMElement();
  });

  it('renders grouped (with parent link), parent count, suppressed, maintenance and similar badges', () => {
    render(
      <IncidentListBadges
        badges={[
          { kind: 'grouped', parentId: 'parent-bbbbb', parentRef: '#BBBBB' },
          { kind: 'parent', count: 12 },
          { kind: 'suppressed', label: 'Suppressed by Known noisy probe' },
          { kind: 'maintenance', label: 'In maintenance: DB upgrade' },
          { kind: 'similar', incidentId: 'old-ccccc', ref: '#CCCCC', confidencePercent: 91 },
        ]}
      />
    );
    expect(
      screen.getByRole('link', { name: 'Grouped under parent incident #BBBBB' })
    ).toHaveAttribute('href', '/incidents/parent-bbbbb');
    expect(screen.getByText('12 grouped')).toBeInTheDocument();
    expect(screen.getByText('Suppressed by Known noisy probe')).toBeInTheDocument();
    expect(screen.getByText('In maintenance: DB upgrade')).toBeInTheDocument();
    const similar = screen.getByRole('link', {
      name: 'Similar to incident #CCCCC, 91% confidence',
    });
    expect(similar).toHaveAttribute('href', '/incidents/old-ccccc');
    expect(similar).toHaveTextContent('Similar to #CCCCC');
    // Row clicks navigate to the row's incident: badge links opt out of that.
    expect(similar).toHaveAttribute('data-no-row-nav', 'true');
  });

  it('does not link a parent the viewer may not read', () => {
    render(<IncidentListBadges badges={[{ kind: 'grouped', parentId: null, parentRef: null }]} />);
    expect(screen.getByText('Grouped')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
