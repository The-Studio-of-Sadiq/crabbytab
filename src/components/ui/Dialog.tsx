"use client";

import React, { RefObject, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/Button";
import { useFocusTrap } from "@/components/ui/useFocusTrap";

export interface DialogProps {
  open: boolean;
  /** Called on Escape, backdrop click or the close button. */
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Right-aligned action row, typically Cancel + primary action. */
  footer?: React.ReactNode;
  /** Use "alertdialog" for confirmations that interrupt the user. */
  role?: "dialog" | "alertdialog";
  size?: "sm" | "md" | "lg";
  /** Element to focus when the dialog opens; defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When false, Escape/backdrop/close button are ignored (e.g. while saving). */
  dismissible?: boolean;
  /** Leading icon shown next to the title. */
  icon?: React.ReactNode;
  className?: string;
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" };

/**
 * Modal dialog with a focus trap, Escape to close and focus restoration.
 *
 * It renders in place (no portal) so it inherits the surrounding theme scope;
 * `position: fixed` still lifts it above the page.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  role = "dialog",
  size = "md",
  initialFocusRef,
  dismissible = true,
  icon,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = () => {
    if (dismissible) onClose();
  };

  useFocusTrap(panelRef, { active: open, onEscape: close, initialFocusRef });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-overlay/50" aria-hidden="true" onClick={close} />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface text-fg shadow-lg focus:outline-none",
          sizeClasses[size],
          className
        )}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          {icon && <div className="mt-0.5 shrink-0 [&_svg]:h-4 [&_svg]:w-4">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold leading-6">
              {title}
            </h2>
            {description && (
              <div id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-fg-muted">
                {description}
              </div>
            )}
          </div>
          {dismissible && (
            <IconButton label="Close dialog" icon={<X />} size="sm" onClick={close} className="-mr-2 -mt-1" />
          )}
        </div>
        {children && <div className="min-h-0 overflow-y-auto px-5 pb-4 text-[13px]">{children}</div>}
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
