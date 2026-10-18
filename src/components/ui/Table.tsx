import React from "react";
import { cn } from "@/components/ui/cn";

type Align = "left" | "center" | "right";
const alignClass: Record<Align, string> = { left: "text-left", center: "text-center", right: "text-right" };

/**
 * Bordered, horizontally scrollable frame for a table. Give it a max height
 * (e.g. `className="max-h-[70vh]"`) to make the sticky header pin while the
 * table body scrolls.
 */
export function TableContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-auto rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("ui-table w-full border-separate border-spacing-0 text-left text-[13px] tabular-nums text-fg", className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("sticky top-0 z-[1] bg-muted", className)} {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("group/row [&:last-child>td]:border-b-0", className)} {...props} />;
}

export function TH({
  align = "left",
  className,
  scope = "col",
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope={scope}
      className={cn(
        "whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted",
        alignClass[align],
        className
      )}
      {...props}
    />
  );
}

export function TD({
  align = "left",
  numeric = false,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-border px-3 py-1.5 align-middle group-hover/row:bg-muted/50",
        alignClass[numeric && align === "left" ? "right" : align],
        numeric && "font-mono text-xs",
        className
      )}
      {...props}
    />
  );
}

/** A full-width row shown when a table has no data. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-[13px] text-fg-muted">
        {children}
      </td>
    </tr>
  );
}
