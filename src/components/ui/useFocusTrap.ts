"use client";

import { RefObject, useEffect, useRef } from "react";
import { getFocusableElements } from "@/components/ui/focus";

/**
 * Keeps keyboard focus inside `containerRef` while `active`, closes on Escape,
 * and returns focus to the previously focused element when deactivated.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  {
    active,
    onEscape,
    initialFocusRef,
  }: {
    active: boolean;
    onEscape?: () => void;
    initialFocusRef?: RefObject<HTMLElement | null>;
  }
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = initialFocusRef?.current ?? getFocusableElements(container)[0] ?? container;
    target.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (onEscapeRef.current) {
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef, initialFocusRef]);
}
