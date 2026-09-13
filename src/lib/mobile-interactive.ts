/**
 * Canonical selector for interactive elements across all mobile gesture surfaces
 * (PullToRefresh, MobileSwipeNavigator, card gestures).
 *
 * Protecting these selectors guarantees that links, buttons, inputs, and custom
 * role-based interactive targets are not swallowed or hijacked by pull-down or
 * swipe navigation.
 */
export const MOBILE_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  '[data-swipe-ignore]',
  '[data-disable-pull]',
].join(', ');

/**
 * Returns true if the event target (or an ancestor) matches any interactive mobile element.
 */
export function isInteractiveMobileTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const match = target.closest(MOBILE_INTERACTIVE_SELECTOR);
  return match instanceof Element;
}
