import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import SessionIdleSelect from '@/components/settings/mcp/SessionIdleSelect';

afterEach(cleanup);

it.each([30, 17])(
  'names the session lifetime control for assistive technology (value %s)',
  value => {
    // An unlisted value renders no visible text in the trigger, which left the button with no
    // accessible name (axe: button-name, WCAG 4.1.2). It carries its own name now.
    render(<SessionIdleSelect defaultValue={value} />);
    expect(screen.getByRole('combobox', { name: 'Session lifetime' })).toBeTruthy();
  }
);
