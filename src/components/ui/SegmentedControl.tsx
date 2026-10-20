"use client";

import React, { useRef } from "react";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Shown as the option's tooltip and read after its label. */
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

/**
 * One choice from a few mutually exclusive options, shown side by side (a WAI-ARIA radio group):
 * arrow keys move and select, Home/End jump to the ends, and only the selected option is in the
 * tab order. The selection is marked by fill and a check-style border, not by colour alone.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size = "md",
  className,
}: {
  /** Accessible name of the group (visually hidden). */
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled && !disabled);

  const select = (index: number) => {
    const option = options[index];
    if (!option || option.disabled || disabled) return;
    refs.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const position = enabled.findIndex((item) => item.index === index);
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = enabled[(position + 1) % enabled.length]?.index;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = enabled[(position - 1 + enabled.length) % enabled.length]?.index;
    else if (event.key === "Home") next = enabled[0]?.index;
    else if (event.key === "End") next = enabled[enabled.length - 1]?.index;
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  const selectedIndex = options.findIndex((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn("inline-flex flex-wrap rounded-md border border-border-strong bg-surface p-0.5", className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const tabbable = checked || (selectedIndex < 0 && index === enabled[0]?.index);
        return (
          <button
            key={option.value}
            ref={(element) => { refs.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={checked}
            title={option.description}
            disabled={disabled || option.disabled}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
              checked
                ? "border-accent bg-accent-subtle text-accent-text"
                : "border-transparent text-fg-muted hover:bg-muted hover:text-fg",
              focusRing
            )}
          >
            {option.icon}
            <span>{option.label}</span>
            {option.description && <span className="sr-only">: {option.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
