import React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Placeholder block shown while content loads. Decorative; pair with a status message. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-6 py-10 text-center",
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-fg-subtle [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Horizontal progress bar. `label` is its accessible name; show the numbers as text nearby too. */
export function ProgressBar({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", percent >= 100 ? "bg-success" : "bg-accent")}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

type AlertTone ="info" | "success" | "warning" | "danger";

const alertTone: Record<AlertTone, { className: string; icon: React.ReactNode }> = {
  info: { className: "border-info-border bg-info-subtle", icon: <Info className="text-info" aria-hidden="true" /> },
  success: {
    className: "border-success-border bg-success-subtle",
    icon: <CheckCircle2 className="text-success" aria-hidden="true" />,
  },
  warning: {
    className: "border-warning-border bg-warning-subtle",
    icon: <AlertTriangle className="text-warning" aria-hidden="true" />,
  },
  danger: { className: "border-danger-border bg-danger-subtle", icon: <XCircle className="text-danger" aria-hidden="true" /> },
};

/** Inline message box. Use role="alert" for errors the user must notice now. */
export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const { className: toneClassName, icon } = alertTone[tone];
  return (
    <div role={role} className={cn("flex gap-3 rounded-lg border p-3 text-[13px] text-fg [&_svg]:h-4 [&_svg]:w-4", toneClassName, className)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-fg-muted">{children}</div>}
      </div>
    </div>
  );
}
