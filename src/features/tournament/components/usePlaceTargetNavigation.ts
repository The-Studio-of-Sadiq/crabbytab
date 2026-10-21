"use client";

import { useEffect, useRef } from "react";

/** Marks an element as a place/swap target while something is picked. */
export const PLACE_TARGET_ATTR = "data-place-target";
/** Stable key on a control that picks an item, so focus can return to it after re-renders. */
export const PICK_KEY_ATTR = "data-pick-key";

const NEXT_KEYS = new Set(["ArrowDown", "ArrowRight"]);
const PREVIOUS_KEYS = new Set(["ArrowUp", "ArrowLeft"]);

function targets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${PLACE_TARGET_ATTR}]`)).filter(
    (element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0
  );
}

/**
 * Keyboard support for "pick, then place" editing (draw editor, allocation editor), so every drag
 * action also works without a mouse and on touch screens:
 *
 * - When a pick starts, focus moves to the first place target (`data-place-target`).
 * - Arrow keys, Home and End move focus between targets in page order; Enter/Space activate them
 *   (they are buttons).
 * - Escape cancels the pick.
 * - When the pick ends, focus returns to the control that started it, found again by its
 *   `data-pick-key` when React re-rendered it, else to `fallbackKey`'s control if given.
 */
export function usePlaceTargetNavigation(active: boolean, onCancel: () => void, fallbackKey?: string | null) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const fallbackRef = useRef(fallbackKey);
  fallbackRef.current = fallbackKey;

  useEffect(() => {
    if (!active) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originKey = origin?.closest<HTMLElement>(`[${PICK_KEY_ATTR}]`)?.getAttribute(PICK_KEY_ATTR) ?? null;
    const frame = window.requestAnimationFrame(() => targets()[0]?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !current.hasAttribute(PLACE_TARGET_ATTR)) return;
      const list = targets();
      const index = list.indexOf(current);
      if (index < 0 || list.length === 0) return;
      let next: HTMLElement | undefined;
      if (NEXT_KEYS.has(event.key)) next = list[(index + 1) % list.length];
      else if (PREVIOUS_KEYS.has(event.key)) next = list[(index - 1 + list.length) % list.length];
      else if (event.key === "Home") next = list[0];
      else if (event.key === "End") next = list[list.length - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      // Restore after React has committed the post-pick render.
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        // Leave focus alone if the user already moved it somewhere meaningful (not a vanished target).
        if (active && active !== document.body && !active.hasAttribute(PLACE_TARGET_ATTR)) return;
        const byKey = (key: string | null | undefined) =>
          key ? document.querySelector<HTMLElement>(`[${PICK_KEY_ATTR}="${CSS.escape(key)}"]`) : null;
        const restore = (origin?.isConnected ? origin : null) ?? byKey(originKey) ?? byKey(fallbackRef.current);
        restore?.focus();
      });
    };
  }, [active]);
}
