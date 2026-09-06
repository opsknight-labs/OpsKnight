/**
 * Accessibility utilities for consistent ARIA labels and keyboard navigation
 */

/**
 * Generates a descriptive ARIA label for action buttons
 */
export function getActionAriaLabel(action: string, entity: string, isLoading?: boolean): string {
  if (isLoading) {
    return `${action} ${entity}...`;
  }
  return `${action} ${entity}`;
}

/**
 * Generates ARIA label for icon buttons
 */
export function getIconButtonAriaLabel(icon: string, action: string, entity?: string): string {
  if (entity) {
    return `${action} ${entity}`;
  }
  return action;
}

/**
 * Common ARIA labels for actions
 */
export const ARIA_LABELS = {
  // Actions
  CREATE: 'Create',
  EDIT: 'Edit',
  DELETE: 'Delete',
  SAVE: 'Save',
  CANCEL: 'Cancel',
  CLOSE: 'Close',
  SUBMIT: 'Submit',
  SEARCH: 'Search',
  FILTER: 'Filter',
  SORT: 'Sort',
  EXPORT: 'Export',
  REFRESH: 'Refresh',
  
  // Navigation
  NEXT: 'Next page',
  PREVIOUS: 'Previous page',
  FIRST: 'First page',
  LAST: 'Last page',
  
  // Incidents
  ACKNOWLEDGE: 'Acknowledge incident',
  RESOLVE: 'Resolve incident',
  ASSIGN: 'Assign incident',
  REASSIGN: 'Reassign incident',
  SNOOZE: 'Snooze incident',
  UNSNOOZE: 'Unsnooze incident',
  SUPPRESS: 'Suppress incident',
  ADD_NOTE: 'Add note',
  ADD_WATCHER: 'Add watcher',
  
  // Notifications
  MARK_READ: 'Mark as read',
  MARK_ALL_READ: 'Mark all as read',
  DELETE_NOTIFICATION: 'Delete notification',
  
  // Common UI
  EXPAND: 'Expand',
  COLLAPSE: 'Collapse',
  OPEN_MENU: 'Open menu',
  CLOSE_MENU: 'Close menu',
  SHOW_MORE: 'Show more',
  SHOW_LESS: 'Show less',
} as const;

/**
 * Keyboard event handlers for common interactions
 */
export const KEYBOARD_HANDLERS = {
  /**
   * Handle Enter/Space key press (for buttons/clickable elements)
   */
  handleButtonKeyDown: (
    event: React.KeyboardEvent,
    handler: () => void,
    disabled?: boolean
  ) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  },
  
  /**
   * Handle Escape key press (for closing modals/dropdowns)
   */
  handleEscapeKey: (
    event: React.KeyboardEvent,
    handler: () => void
  ) => {
    if (event.key === 'Escape') {
      handler();
    }
  },
  
  /**
   * Handle arrow key navigation (for lists/menus)
   */
  handleArrowKeys: (
    event: React.KeyboardEvent,
    handlers: {
      onUp?: () => void;
      onDown?: () => void;
      onLeft?: () => void;
      onRight?: () => void;
    }
  ) => {
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        handlers.onUp?.();
        break;
      case 'ArrowDown':
        event.preventDefault();
        handlers.onDown?.();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        handlers.onLeft?.();
        break;
      case 'ArrowRight':
        event.preventDefault();
        handlers.onRight?.();
        break;
    }
  },
} as const;

