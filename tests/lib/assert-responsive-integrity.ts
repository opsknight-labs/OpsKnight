import { expect, type Page } from '@playwright/test';

export type ResponsiveIntegrityOptions = {
  /** Maximum allowed protruding pixels (subpixel tolerance, default 1px) */
  tolerancePx?: number;
  /** Whether to enforce 44px minimum touch targets on buttons/inputs (default true) */
  enforceTouchTargets?: boolean;
  /** Selectors to exclude from touch target height enforcement (e.g. icon-only utility links) */
  touchTargetExclusions?: string[];
  /** Allow specific horizontal scrollers if intentional (e.g. horizontal code block or swipe container) */
  allowHorizontalScrollSelectors?: string[];
};

export type ResponsiveViolation = {
  type:
    | 'VIEWPORT_OVERFLOW_RIGHT'
    | 'VIEWPORT_OVERFLOW_LEFT'
    | 'COLLISION_OVERLAP'
    | 'TOUCH_TARGET_BELOW_44PX'
    | 'ZERO_WIDTH_TEXT'
    | 'NOWRAP_OVERFLOW_NO_ELLIPSIS'
    | 'DOCUMENT_HORIZONTAL_SCROLL';
  selector: string;
  details: string;
  rect?: { x: number; y: number; width: number; height: number };
};

export async function checkResponsiveIntegrity(
  page: Page,
  options: ResponsiveIntegrityOptions = {}
): Promise<ResponsiveViolation[]> {
  return page.evaluate(
    (opts: {
      tolerance: number;
      enforceTouchTargets: boolean;
      exclusions: string[];
      allowScrollSelectors: string[];
    }) => {
      const violations: Array<{
        type:
          | 'VIEWPORT_OVERFLOW_RIGHT'
          | 'VIEWPORT_OVERFLOW_LEFT'
          | 'COLLISION_OVERLAP'
          | 'TOUCH_TARGET_BELOW_44PX'
          | 'ZERO_WIDTH_TEXT'
          | 'NOWRAP_OVERFLOW_NO_ELLIPSIS'
          | 'DOCUMENT_HORIZONTAL_SCROLL';
        selector: string;
        details: string;
        rect?: { x: number; y: number; width: number; height: number };
      }> = [];

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // 1. Overall document horizontal scroll
      if (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + opts.tolerance
      ) {
        violations.push({
          type: 'DOCUMENT_HORIZONTAL_SCROLL',
          selector: 'html',
          details: `document.scrollWidth (${document.documentElement.scrollWidth}px) exceeds clientWidth (${document.documentElement.clientWidth}px)`,
        });
      }

      function getPath(el: Element): string {
        if (el.id) return `#${el.id}`;
        const className =
          el.className && typeof el.className === 'string'
            ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
        return `${el.tagName.toLowerCase()}${className}`;
      }

      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const allElements = Array.from(document.body.querySelectorAll('*'));

      for (const el of allElements) {
        if (!isVisible(el)) continue;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        // Check if matching allowed scroller
        const isAllowedScroller = opts.allowScrollSelectors.some(sel => el.matches(sel));

        // A. Viewport bounds (does element protrude beyond right screen edge?)
        // Skip elements whose ancestors are deliberate horizontal carousels/scrollers
        if (!isAllowedScroller && rect.right > viewportWidth + opts.tolerance) {
          // Check if clipped by an intentional container with hidden/auto
          let parent = el.parentElement;
          let hasExplicitScrollParent = false;
          while (parent && parent !== document.body) {
            const pStyle = window.getComputedStyle(parent);
            if (pStyle.overflowX === 'auto' || pStyle.overflowX === 'scroll') {
              hasExplicitScrollParent = true;
              break;
            }
            parent = parent.parentElement;
          }

          if (!hasExplicitScrollParent) {
            violations.push({
              type: 'VIEWPORT_OVERFLOW_RIGHT',
              selector: getPath(el),
              details: `Element right edge (${Math.round(rect.right)}px) protrudes beyond viewport (${viewportWidth}px)`,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
        }

        // B. Left bounds
        if (!isAllowedScroller && rect.left < -opts.tolerance) {
          let parent = el.parentElement;
          let hasExplicitScrollParent = false;
          while (parent && parent !== document.body) {
            const pStyle = window.getComputedStyle(parent);
            if (pStyle.overflowX === 'auto' || pStyle.overflowX === 'scroll') {
              hasExplicitScrollParent = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (!hasExplicitScrollParent) {
            violations.push({
              type: 'VIEWPORT_OVERFLOW_LEFT',
              selector: getPath(el),
              details: `Element left edge (${Math.round(rect.left)}px) starts before 0px`,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
        }

        // C. Flex text compression to zero width
        if (el.children.length === 0 && (el.textContent || '').trim().length > 0) {
          if (rect.width <= 0 && rect.height > 0) {
            violations.push({
              type: 'ZERO_WIDTH_TEXT',
              selector: getPath(el),
              details: `Text "${(el.textContent || '').slice(0, 20)}" compressed to 0px width`,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
        }

        // D. Nowrap overflow without ellipsis
        if (style.whiteSpace === 'nowrap' && !isAllowedScroller) {
          if (
            el.scrollWidth > el.clientWidth + opts.tolerance &&
            style.textOverflow !== 'ellipsis'
          ) {
            violations.push({
              type: 'NOWRAP_OVERFLOW_NO_ELLIPSIS',
              selector: getPath(el),
              details: `nowrap element scrollWidth (${el.scrollWidth}px) exceeds clientWidth (${el.clientWidth}px) without text-overflow: ellipsis`,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
        }

        // E. Touch target dimensions on primary interactive elements
        if (opts.enforceTouchTargets) {
          const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
          const isInput =
            el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
          const isExcluded = opts.exclusions.some(sel => el.matches(sel));

          if ((isButton || isInput) && !isExcluded) {
            // Check computed or bounding dimensions
            if (rect.height < 44 - opts.tolerance) {
              // Only report if it's within viewport bounds
              if (rect.top >= 0 && rect.bottom <= viewportHeight + 100) {
                violations.push({
                  type: 'TOUCH_TARGET_BELOW_44PX',
                  selector: getPath(el),
                  details: `Interactive element height (${Math.round(rect.height)}px) is below 44px touch target guideline`,
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                });
              }
            }
          }
        }
      }

      // F. Element collision/overlap detection:
      // Compares visible unnested interactive/heading elements for unexpected bounding box intersections.
      const collisionCandidates = allElements.filter(el => {
        if (!isVisible(el)) return false;
        const tag = el.tagName;
        const isInteractive =
          tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT';
        const isHeading = /^H[1-6]$/.test(tag);
        const isTextOrBadge =
          tag === 'P' ||
          (tag === 'SPAN' && (el.classList.contains('badge') || el.hasAttribute('role'))) ||
          el.hasAttribute('data-badge');
        return isInteractive || isHeading || isTextOrBadge;
      });

      collisionCandidates.forEach((elA, i) => {
        const rectA = elA.getBoundingClientRect();
        for (const elB of collisionCandidates.slice(i + 1)) {
          if (elA.contains(elB) || elB.contains(elA)) continue;

          const rectB = elB.getBoundingClientRect();
          const overlapX = Math.max(
            0,
            Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left)
          );
          const overlapY = Math.max(
            0,
            Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top)
          );

          if (overlapX > 6 && overlapY > 6) {
            const styleA = window.getComputedStyle(elA);
            const styleB = window.getComputedStyle(elB);
            if (styleA.pointerEvents === 'none' || styleB.pointerEvents === 'none') continue;
            if (styleA.position === 'fixed' || styleB.position === 'fixed') continue;

            violations.push({
              type: 'COLLISION_OVERLAP',
              selector: `${getPath(elA)} collides with ${getPath(elB)}`,
              details: `Visible elements overlap by ${Math.round(overlapX)}x${Math.round(overlapY)}px`,
              rect: { x: rectA.x, y: rectA.y, width: rectA.width, height: rectA.height },
            });
          }
        }
      });

      return violations;
    },
    {
      tolerance: options.tolerancePx ?? 1,
      enforceTouchTargets: options.enforceTouchTargets ?? true,
      exclusions: options.touchTargetExclusions ?? [
        'input[type="checkbox"]',
        'input[type="radio"]',
        '.mobile-nav-item',
        '[data-touch-exempt]',
        'button.absolute',
      ],
      allowScrollSelectors: options.allowHorizontalScrollSelectors ?? [
        '[data-swipe-container]',
        '.overflow-x-auto',
        '.overflow-x-scroll',
      ],
    }
  );
}

export async function assertResponsiveIntegrity(
  page: Page,
  options: ResponsiveIntegrityOptions = {}
): Promise<void> {
  const violations = await checkResponsiveIntegrity(page, options);
  if (violations.length > 0) {
    const summary = violations.map(v => `[${v.type}] ${v.selector}: ${v.details}`).join('\n');
    expect(violations, `Responsive integrity violations found:\n${summary}`).toHaveLength(0);
  }
}
