"use client";

import React, { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

const MenuContext = createContext<{ close: () => void } | null>(null);

function useMenu() {
  const context = useContext(MenuContext);
  if (!context) throw new Error("Dropdown menu items must be rendered inside <DropdownMenu>.");
  return context;
}

const ITEM_SELECTOR = "[role^='menuitem']:not([aria-disabled='true'])";

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
}

/**
 * Menu button (WAI-ARIA menu pattern): click or Enter/Space/ArrowDown opens it,
 * arrow keys move between items, Escape or Tab closes it, and focus returns to
 * the trigger.
 */
export function DropdownMenu({
  trigger,
  triggerLabel,
  triggerClassName,
  align = "start",
  menuClassName,
  children,
}: {
  /** Visible trigger content. */
  trigger: React.ReactNode;
  /** Accessible name for the trigger when its content is not descriptive text. */
  triggerLabel?: string;
  triggerClassName?: string;
  align?: "start" | "end";
  menuClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusFirstOnOpen = useRef<"first" | "last">("first");

  const items = () => menuItems(menuRef.current);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const list = menuItems(menuRef.current);
    (focusFirstOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusFirstOnOpen.current = event.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list[list.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => {
          focusFirstOnOpen.current = "first";
          setOpen((value) => !value);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium text-fg transition-colors hover:bg-muted",
          focusRing,
          triggerClassName
        )}
      >
        {trigger}
      </button>
      {open && (
        <MenuContext.Provider value={{ close: () => close() }}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={triggerLabel}
            onKeyDown={handleMenuKeyDown}
            className={cn(
              "absolute top-full z-50 mt-1 max-h-[min(70vh,28rem)] min-w-[12rem] overflow-y-auto rounded-lg border border-border bg-surface p-1 text-[13px] text-fg shadow-lg",
              align === "end" ? "right-0" : "left-0",
              menuClassName
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

const itemClasses = cn(
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none",
  "hover:bg-muted focus-visible:bg-muted focus:bg-muted",
  "aria-disabled:pointer-events-none aria-disabled:opacity-50",
  "[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle"
);

type ItemTone = "default" | "danger";

export function DropdownMenuItem({
  icon,
  onSelect,
  href,
  external,
  disabled,
  tone = "default",
  children,
}: {
  icon?: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  /** Open `href` in a new tab. */
  external?: boolean;
  disabled?: boolean;
  tone?: ItemTone;
  children: React.ReactNode;
}) {
  const { close } = useMenu();
  const className = cn(itemClasses, tone === "danger" && "text-danger [&_svg]:text-danger");
  if (href && !disabled) {
    return (
      <Link
        href={href}
        role="menuitem"
        tabIndex={-1}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className={className}
        onClick={close}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={className}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect?.();
      }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

/** A selectable option in a single-choice group (role="menuitemradio"). */
export function DropdownMenuRadioItem({
  checked,
  onSelect,
  icon,
  description,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={itemClasses}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="block truncate text-[11px] text-fg-muted">{description}</span>}
      </span>
      <Check className={cn(!checked && "invisible")} aria-hidden="true" />
    </button>
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div role="presentation" className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}
