"use client";

import React from "react";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

/**
 * A labelled row of toggle buttons for picking one option from a list that may be long (rounds,
 * tab categories). Selection is shown by fill, border and `aria-pressed`, never colour alone.
 */
export function ChoiceChips<T extends string>({
  label,
  showLabel = false,
  options,
  value,
  onChange,
  className,
  children,
}: {
  label: string;
  /** Show the label as visible text before the options. */
  showLabel?: boolean;
  options: { value: T; label: React.ReactNode }[];
  value: T | undefined;
  onChange: (value: T) => void;
  className?: string;
  /** Trailing content, e.g. a "top N" note. */
  children?: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {showLabel && (
        <span aria-hidden="true" className="me-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
          {label}
        </span>
      )}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
              selected
                ? "border-accent bg-accent-subtle text-accent-text"
                : "border-border-strong bg-surface text-fg-muted hover:bg-muted hover:text-fg",
              focusRing
            )}
          >
            {option.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}
