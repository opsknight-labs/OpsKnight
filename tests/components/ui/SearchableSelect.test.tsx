import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import SearchableSelect, {
  filterOptions,
  type SearchableOption,
} from '@/components/ui/SearchableSelect';

const services: SearchableOption[] = [
  { value: 's1', label: 'Checkout API', description: 'Payments team' },
  { value: 's2', label: 'Search', description: 'Discovery team' },
  { value: 's3', label: 'Étoile billing', group: 'Finance' },
  { value: 's4', label: 'Checkout API', description: 'Legacy copy' },
];

function setup(props: Partial<React.ComponentProps<typeof SearchableSelect>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <form>
      <label htmlFor="svc">Service</label>
      <SearchableSelect
        id="svc"
        name="serviceId"
        options={services}
        onChange={onChange}
        {...props}
      />
    </form>
  );
  const sent = () => new FormData(view.container.querySelector('form') as HTMLFormElement);
  return { onChange, sent, ...view };
}

const open = () => fireEvent.click(screen.getByRole('combobox', { name: 'Service' }));
const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: text } });

describe('filterOptions', () => {
  it('matches every typed word in the label or description, ignoring case and accents', () => {
    expect(filterOptions(services, 'checkout legacy').map(o => o.value)).toEqual(['s4']);
    expect(filterOptions(services, 'ETOILE').map(o => o.value)).toEqual(['s3']);
    expect(filterOptions(services, 'discovery search').map(o => o.value)).toEqual(['s2']);
    expect(filterOptions(services, '   ')).toHaveLength(4);
    expect(filterOptions(services, 'zzz')).toEqual([]);
  });
});

describe('SearchableSelect', () => {
  it('is a labelled combobox that shows the placeholder until something is picked', () => {
    setup({ placeholder: 'Select a service' });
    const box = screen.getByRole('combobox', { name: 'Service' });
    expect(box).toHaveTextContent('Select a service');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('filters while typing, picks with a click, and sends the value with the form', () => {
    const { onChange, sent } = setup();
    open();
    type('disc');
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(list).getByText('Search'));
    expect(onChange).toHaveBeenCalledWith('s2');
    expect(sent().get('serviceId')).toBe('s2');
    expect(screen.getByRole('combobox', { name: 'Service' })).toHaveTextContent('Search');
  });

  it('keeps two options with the same label apart', () => {
    const { sent } = setup();
    open();
    const twins = screen.getAllByText('Checkout API');
    expect(twins).toHaveLength(2);
    fireEvent.click(screen.getByText('Legacy copy'));
    expect(sent().get('serviceId')).toBe('s4');
  });

  it('works from the keyboard', () => {
    const { sent } = setup();
    open();
    type('bill');
    fireEvent.keyDown(screen.getByPlaceholderText('Search…'), { key: 'Enter' });
    expect(sent().get('serviceId')).toBe('s3');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('says what happened when nothing matches', () => {
    setup({ noun: 'services' });
    open();
    type('qqq');
    expect(screen.getByText(/No services match “qqq”/)).toBeInTheDocument();
  });

  it('can be cleared back to its "all" row', () => {
    const { onChange, sent } = setup({ clearLabel: 'All services', defaultValue: 's1' });
    expect(screen.getByRole('combobox', { name: 'Service' })).toHaveTextContent('Checkout API');
    fireEvent.click(screen.getByRole('button', { name: 'Clear: All services' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(sent().get('serviceId')).toBe('');
    expect(screen.getByRole('combobox', { name: 'Service' })).toHaveTextContent('All services');
    open();
    expect(screen.getByText('All services', { selector: 'span.block' })).toBeInTheDocument();
  });

  it('follows a controlled value and submits nothing without a name', () => {
    const { container, rerender } = render(
      <form>
        <SearchableSelect id="x" options={services} value="s2" aria-label="Service" />
      </form>
    );
    expect(screen.getByRole('combobox', { name: 'Service' })).toHaveTextContent('Search');
    expect(new FormData(container.querySelector('form') as HTMLFormElement).has('serviceId')).toBe(
      false
    );
    rerender(
      <form>
        <SearchableSelect id="x" options={services} value="s3" aria-label="Service" />
      </form>
    );
    expect(screen.getByRole('combobox', { name: 'Service' })).toHaveTextContent('Étoile billing');
  });

  it('shows only the first 100 matches and tells the person to keep typing', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ value: `v${i}`, label: `Service ${i}` }));
    render(<SearchableSelect id="m" options={many} aria-label="Service" noun="services" />);
    open();
    expect(screen.getAllByRole('option')).toHaveLength(100);
    expect(screen.getByText(/Showing 100 of 250 services/)).toBeInTheDocument();
  });

  it('does not open when disabled', () => {
    setup({ disabled: true });
    open();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
