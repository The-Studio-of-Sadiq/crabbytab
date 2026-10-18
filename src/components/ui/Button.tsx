import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface text-fg hover:bg-muted",
  ghost: "text-fg-muted hover:bg-muted hover:text-fg",
  danger: "bg-danger-solid text-white hover:bg-danger-solid/90",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-8 px-3 text-[13px]",
  lg: "h-10 px-4 text-sm",
};

const iconSizes: Record<ButtonSize, string> = {
  sm: "h-7 w-7 [&_svg]:h-3.5 [&_svg]:w-3.5",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

/** Class names for a button look-alike, e.g. a Next.js <Link>. */
export function buttonClasses({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, focusRing, variants[variant], sizes[size], className);
}

/** Class names for an icon-only button look-alike. Give the element an aria-label. */
export function iconButtonClasses({
  variant = "ghost",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, focusRing, variants[variant], iconSizes[size], "px-0", className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  /** Text shown while loading; defaults to the children. */
  loadingText?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, loadingText, disabled, className, children, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {loading && loadingText !== undefined ? loadingText : children}
    </button>
  );
});

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name; also used as the tooltip. Required because the button has no visible text. */
  label: string;
  icon: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "ghost", size = "md", className, type = "button", title, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={iconButtonClasses({ variant, size, className })}
      {...props}
    >
      {icon}
    </button>
  );
});
