import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import {
  IncidentCreationModalProvider,
  useCreateIncidentModal,
} from '@/contexts/IncidentCreationModalContext';
import CreateIncidentButton, {
  CreateIncidentMenuItem,
} from '@/components/incident/CreateIncidentButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';

function TestConsumer() {
  const { isOpen, openOptions, openCreateIncident, closeCreateIncident } = useCreateIncidentModal();

  return (
    <div>
      <div data-testid="modal-state">{isOpen ? 'open' : 'closed'}</div>
      <div data-testid="service-id">{openOptions?.serviceId || 'none'}</div>
      <div data-testid="template-id">{openOptions?.templateId || 'none'}</div>
      <button onClick={() => openCreateIncident()}>Open Default</button>
      <button onClick={() => openCreateIncident({ serviceId: 'srv-123', templateId: 'tmpl-456' })}>
        Open With Options
      </button>
      <button onClick={() => closeCreateIncident()}>Close</button>
    </div>
  );
}

describe('Incident Creation Modal System', () => {
  describe('IncidentCreationModalContext', () => {
    it('manages open/close state and options correctly', () => {
      render(
        <IncidentCreationModalProvider>
          <TestConsumer />
        </IncidentCreationModalProvider>
      );

      expect(screen.getByTestId('modal-state').textContent).toBe('closed');
      expect(screen.getByTestId('service-id').textContent).toBe('none');
      expect(screen.getByTestId('template-id').textContent).toBe('none');

      // Open default
      fireEvent.click(screen.getByText('Open Default'));
      expect(screen.getByTestId('modal-state').textContent).toBe('open');
      expect(screen.getByTestId('service-id').textContent).toBe('none');

      // Close
      fireEvent.click(screen.getByText('Close'));
      expect(screen.getByTestId('modal-state').textContent).toBe('closed');

      // Open with options
      fireEvent.click(screen.getByText('Open With Options'));
      expect(screen.getByTestId('modal-state').textContent).toBe('open');
      expect(screen.getByTestId('service-id').textContent).toBe('srv-123');
      expect(screen.getByTestId('template-id').textContent).toBe('tmpl-456');
    });

    it('falls back gracefully when hook used outside provider', () => {
      render(<TestConsumer />);
      expect(screen.getByTestId('modal-state').textContent).toBe('closed');
      expect(screen.getByTestId('service-id').textContent).toBe('none');
    });
  });

  describe('CreateIncidentButton', () => {
    it('renders and triggers openCreateIncident on click', () => {
      render(
        <IncidentCreationModalProvider>
          <TestConsumer />
          <CreateIncidentButton serviceId="srv-999">Trigger Custom</CreateIncidentButton>
        </IncidentCreationModalProvider>
      );

      fireEvent.click(screen.getByText('Trigger Custom'));
      expect(screen.getByTestId('modal-state').textContent).toBe('open');
      expect(screen.getByTestId('service-id').textContent).toBe('srv-999');
    });

    it('triggers openCreateIncident with templateId on click', () => {
      render(
        <IncidentCreationModalProvider>
          <TestConsumer />
          <CreateIncidentButton templateId="tmpl-888">Use Template Button</CreateIncidentButton>
        </IncidentCreationModalProvider>
      );

      fireEvent.click(screen.getByText('Use Template Button'));
      expect(screen.getByTestId('modal-state').textContent).toBe('open');
      expect(screen.getByTestId('template-id').textContent).toBe('tmpl-888');
    });
  });

  describe('CreateIncidentMenuItem', () => {
    it('triggers openCreateIncident with templateId when clicked', () => {
      render(
        <IncidentCreationModalProvider>
          <TestConsumer />
          <DropdownMenu open={true}>
            <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <CreateIncidentMenuItem templateId="tmpl-777">
                Use Template Menu
              </CreateIncidentMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </IncidentCreationModalProvider>
      );

      fireEvent.click(screen.getByText('Use Template Menu'));
      expect(screen.getByTestId('modal-state').textContent).toBe('open');
      expect(screen.getByTestId('template-id').textContent).toBe('tmpl-777');
    });
  });
});
