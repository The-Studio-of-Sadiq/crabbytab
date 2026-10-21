import React from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Info, XCircle } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "border-border bg-muted text-fg-muted",
  accent: "border-accent/30 bg-accent-subtle text-accent-text",
  success: "border-success-border bg-success-subtle text-success",
  warning: "border-warning-border bg-warning-subtle text-warning",
  danger: "border-danger-border bg-danger-subtle text-danger",
  info: "border-info-border bg-info-subtle text-info",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-medium leading-none",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  );
}

const defaultIcons: Record<Tone, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  neutral: Circle,
  accent: CircleDot,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

/**
 * A status label that pairs an icon with text so status is never conveyed by
 * colour alone. Always pass a meaningful `children` label.
 */
export function StatusPill({
  tone,
  icon,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone: Tone;
  /** Override the default icon for the tone. Pass null to hide it. */
  icon?: React.ReactNode | null;
  children: React.ReactNode;
}) {
  const DefaultIcon = defaultIcons[tone];
  return (
    <Badge tone={tone} className={cn("[&_svg]:h-3 [&_svg]:w-3", className)} {...props}>
      {icon === undefined ? <DefaultIcon aria-hidden /> : icon}
      {children}
    </Badge>
  );
}
