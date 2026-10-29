import { describe, it, expect, vi } from 'vitest';
import { ARIA_LABELS, KEYBOARD_HANDLERS, getActionAriaLabel, getIconButtonAriaLabel } from '@/lib/accessibility';

describe('Accessibility Utilities', () => {
  describe('getActionAriaLabel', () => {
    it('should generate action aria label', () => {
      expect(getActionAriaLabel('Create', 'incident')).toBe('Create incident');
    });

    it('should include loading state', () => {
      expect(getActionAriaLabel('Create', 'incident', true)).toBe('Create incident...');
    });
  });

  describe('getIconButtonAriaLabel', () => {
    it('should generate icon button aria label with entity', () => {
      expect(getIconButtonAriaLabel('edit', 'Edit', 'incident')).toBe('Edit incident');
    });

    it('should generate icon button aria label without entity', () => {
      expect(getIconButtonAriaLabel('close', 'Close')).toBe('Close');
    });
  });

  describe('ARIA_LABELS constants', () => {
    it('should have all required action labels', () => {
      expect(ARIA_LABELS.CREATE).toBe('Create');
      expect(ARIA_LABELS.EDIT).toBe('Edit');
      expect(ARIA_LABELS.DELETE).toBe('Delete');
      expect(ARIA_LABELS.SAVE).toBe('Save');
      expect(ARIA_LABELS.CANCEL).toBe('Cancel');
    });

    it('should have navigation labels', () => {
      expect(ARIA_LABELS.NEXT).toBe('Next page');
      expect(ARIA_LABELS.PREVIOUS).toBe('Previous page');
    });

    it('should have incident action labels', () => {
      expect(ARIA_LABELS.ACKNOWLEDGE).toBe('Acknowledge incident');
      expect(ARIA_LABELS.RESOLVE).toBe('Resolve incident');
    });
  });

  describe('KEYBOARD_HANDLERS', () => {
    it('should handle button key down with Enter', () => {
      const handler = vi.fn();
      const event = {
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;
      
      KEYBOARD_HANDLERS.handleButtonKeyDown(event, handler);
      expect(handler).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should handle button key down with Space', () => {
      const handler = vi.fn();
      const event = {
        key: ' ',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;
      
      KEYBOARD_HANDLERS.handleButtonKeyDown(event, handler);
      expect(handler).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should not call handler when disabled', () => {
      const handler = vi.fn();
      const event = {
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;
      
      KEYBOARD_HANDLERS.handleButtonKeyDown(event, handler, true);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle Escape key', () => {
      const handler = vi.fn();
      const event = {
        key: 'Escape',
      } as unknown as React.KeyboardEvent;
      
      KEYBOARD_HANDLERS.handleEscapeKey(event, handler);
      expect(handler).toHaveBeenCalled();
    });

    it('should handle arrow keys', () => {
      const onUp = vi.fn();
      const onDown = vi.fn();
      const onLeft = vi.fn();
      const onRight = vi.fn();
      
      const upEvent = { key: 'ArrowUp', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
      KEYBOARD_HANDLERS.handleArrowKeys(upEvent, { onUp });
      expect(onUp).toHaveBeenCalled();
      
      const downEvent = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
      KEYBOARD_HANDLERS.handleArrowKeys(downEvent, { onDown });
      expect(onDown).toHaveBeenCalled();
      
      const leftEvent = { key: 'ArrowLeft', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
      KEYBOARD_HANDLERS.handleArrowKeys(leftEvent, { onLeft });
      expect(onLeft).toHaveBeenCalled();
      
      const rightEvent = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
      KEYBOARD_HANDLERS.handleArrowKeys(rightEvent, { onRight });
      expect(onRight).toHaveBeenCalled();
    });
  });
});

