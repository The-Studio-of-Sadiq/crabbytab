"use client";

import React, { useRef } from "react";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional count shown after the label. */
  count?: number;
}

const tabId = (id: string, value: string) => `${id}-tab-${value}`;
const panelId = (id: string, value: string) => `${id}-panel-${value}`;

/**
 * Accessible tab list (WAI-ARIA tabs pattern with automatic activation).
 * Render the matching content in a <TabPanel> with the same `id`.
 */
export function Tabs<T extends string>({
  id,
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
}: {
  id: string;
  items: TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = items[nextIndex];
    onValueChange(next.value);
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(id, next.value))}`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border", className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={tabId(id, item.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(id, item.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-medium transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
              selected ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
              focusRing,
              "focus-visible:ring-offset-0"
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span className="rounded-sm bg-muted px-1 text-[11px] tabular-nums text-fg-muted">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  value,
  className,
  children,
}: {
  id: string;
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="tabpanel" id={panelId(id, value)} aria-labelledby={tabId(id, value)} className={className}>
      {children}
    </div>
  );
}
