"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/Button";

type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. Defaults to 5000 (errors: 0). */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

const ToastContext = createContext<{ toast: (options: ToastOptions) => void } | null>(null);

/** Returns `toast()` for showing transient, non-blocking notifications. */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}

const toneIcon: Record<ToastTone, React.ReactNode> = {
  info: <Info className="text-info" aria-hidden="true" />,
  success: <CheckCircle2 className="text-success" aria-hidden="true" />,
  warning: <AlertTriangle className="text-warning" aria-hidden="true" />,
  danger: <XCircle className="text-danger" aria-hidden="true" />,
};

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.duration, toast.id, onDismiss]);

  return (
    <li
      role={toast.tone === "danger" ? "alert" : "status"}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface p-3 text-[13px] text-fg shadow-lg motion-safe:animate-toast-in [&_svg]:h-4 [&_svg]:w-4"
    >
      <span className="mt-0.5 shrink-0">{toneIcon[toast.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-fg-muted">{toast.description}</p>}
      </div>
      <IconButton label="Dismiss notification" icon={<X />} size="sm" onClick={() => onDismiss(toast.id)} className="-my-1 -mr-1" />
    </li>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const tone = options.tone ?? "info";
    const record: ToastRecord = {
      id: nextId.current++,
      title: options.title,
      description: options.description,
      tone,
      duration: options.duration ?? (tone === "danger" ? 0 : 5000),
    };
    setToasts((current) => [...current.slice(-3), record]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ol
        aria-label="Notifications"
        className={cn(
          "pointer-events-none fixed bottom-0 right-0 z-[80] flex w-full flex-col gap-2 p-4 sm:max-w-sm",
          toasts.length === 0 && "hidden"
        )}
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={dismiss} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}
