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
  /** Selectors exempt from collision detection (e.g. an icon button intentionally nested inside its own input) */
  collisionExclusionSelectors?: string[];
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
      collisionExclusions: string[];
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
        let cur: Element | null = el;
        while (cur && cur !== document.documentElement) {
          const style = window.getComputedStyle(cur);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
          }
          if (cur.classList.contains('sr-only')) return false;
          cur = cur.parentElement;
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
            if (
              pStyle.overflowX === 'auto' ||
              pStyle.overflowX === 'scroll' ||
              pStyle.overflowX === 'hidden' ||
              pStyle.overflowX === 'clip' ||
              pStyle.overflow === 'hidden' ||
              pStyle.overflow === 'clip'
            ) {
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
            if (
              pStyle.overflowX === 'auto' ||
              pStyle.overflowX === 'scroll' ||
              pStyle.overflowX === 'hidden' ||
              pStyle.overflowX === 'clip' ||
              pStyle.overflow === 'hidden' ||
              pStyle.overflow === 'clip'
            ) {
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
          // Anchors aren't covered by isButton/isInput, which previously made the
          // app-chrome nav/header links invisible to this check entirely. Scope
          // the anchor check to those two chrome regions rather than every link
          // on the page, since ordinary inline text links are not touch targets.
          const isChromeNavLink =
            el.tagName === 'A' && Boolean(el.closest('.mobile-header, .mobile-nav'));
          const isExcluded = opts.exclusions.some(sel => el.matches(sel));

          if ((isButton || isInput || isChromeNavLink) && !isExcluded) {
            // Check computed or bounding dimensions
            if (rect.height < 44 - opts.tolerance || rect.width < 44 - opts.tolerance) {
              // Only report if it's within viewport bounds
              if (rect.top >= 0 && rect.bottom <= viewportHeight + 100) {
                violations.push({
                  type: 'TOUCH_TARGET_BELOW_44PX',
                  selector: getPath(el),
                  details: `Interactive element size (${Math.round(rect.width)}x${Math.round(rect.height)}px) is below the 44x44px touch target guideline`,
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                });
              }
            }
          }
        }
      }

      // F. Element collision/overlap detection:
      // Compares visible unnested interactive/heading elements for unexpected bounding box intersections.
      // Intersects an element's own rect with every scrolling ancestor's box.
      // Without this, an item positioned just past the end of a scrollable
      // container's clipped viewport (e.g. the last row in `.mobile-content`,
      // which is a separate grid row from the fixed bottom nav and can never
      // actually render behind it) still reports a raw bounding rect that
      // extends past the clip boundary, producing a false "collides with the
      // nav" result even though the browser never paints it there.
      function getClippedRect(el: Element) {
        const rect = el.getBoundingClientRect();
        let top = rect.top;
        let left = rect.left;
        let right = rect.right;
        let bottom = rect.bottom;
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          const parentStyle = window.getComputedStyle(parent);
          const clips = ['hidden', 'auto', 'scroll', 'clip'];
          if (clips.includes(parentStyle.overflowY) || clips.includes(parentStyle.overflow)) {
            const parentRect = parent.getBoundingClientRect();
            top = Math.max(top, parentRect.top);
            left = Math.max(left, parentRect.left);
            right = Math.min(right, parentRect.right);
            bottom = Math.min(bottom, parentRect.bottom);
          }
          parent = parent.parentElement;
        }
        return {
          top,
          left,
          right,
          bottom,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        };
      }

      const collisionCandidates = allElements.filter(el => {
        if (!isVisible(el)) return false;
        // e.g. a password show/hide toggle (`button.absolute`) deliberately
        // nested inside its own input's `relative` wrapper -- a standard
        // compound-control pattern, not a layout bug.
        if (opts.collisionExclusions.some(sel => el.matches(sel))) return false;
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
        const rectA = getClippedRect(elA);
        if (rectA.width <= 0 || rectA.height <= 0) return;
        for (const elB of collisionCandidates.slice(i + 1)) {
          if (elA.contains(elB) || elB.contains(elA)) continue;

          const rectB = getClippedRect(elB);
          if (rectB.width <= 0 || rectB.height <= 0) continue;
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
            const isFixedOrSticky = (el: Element): boolean => {
              let cur: Element | null = el;
              while (cur && cur !== document.body) {
                const pos = window.getComputedStyle(cur).position;
                if (pos === 'fixed' || pos === 'sticky') return true;
                cur = cur.parentElement;
              }
              return false;
            };
            if (isFixedOrSticky(elA) || isFixedOrSticky(elB)) continue;

            violations.push({
              type: 'COLLISION_OVERLAP',
              selector: `${getPath(elA)} collides with ${getPath(elB)}`,
              details: `Visible elements overlap by ${Math.round(overlapX)}x${Math.round(overlapY)}px`,
              rect: { x: rectA.left, y: rectA.top, width: rectA.width, height: rectA.height },
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
        '[data-touch-exempt]',
        'button.absolute',
      ],
      allowScrollSelectors: options.allowHorizontalScrollSelectors ?? [
        '[data-swipe-container]',
        '.overflow-x-auto',
        '.overflow-x-scroll',
      ],
      collisionExclusions: options.collisionExclusionSelectors ?? ['button.absolute'],
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

/**
 * Regression guard for the mobile segmented-control label wrapping bug
 * ("System" -> "Syste" / "m"): asserts that every element matched by
 * `selector` renders its text as a single, unwrapped line.
 */
export async function assertSingleLineLabels(page: Page, selector: string): Promise<void> {
  const wrapped = await page.evaluate(sel => {
    const elements = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
    return elements
      .filter(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        const singleLineHeight = Number.isFinite(lineHeight) ? lineHeight : rect.height;
        return rect.height > singleLineHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      })
      .map(el => el.textContent?.trim() ?? '(empty)');
  }, selector);

  expect(
    wrapped,
    `Labels matching "${selector}" wrapped or overflowed instead of rendering on one line: ${wrapped.join(', ')}`
  ).toHaveLength(0);
}
