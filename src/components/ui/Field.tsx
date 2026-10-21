"use client";

import React, { useId } from "react";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs font-medium text-fg", className)} {...props} />;
}

interface FieldChromeProps {
  /** Visible label. Omit only when the control is labelled another way (aria-label). */
  label?: React.ReactNode;
  /** Help text shown under the control. */
  help?: React.ReactNode;
  /** Validation message; marks the control invalid. */
  error?: React.ReactNode;
  /** Classes for the wrapper around label, control and messages. */
  wrapperClassName?: string;
}

function useFieldIds(id: string | undefined, help: unknown, error: unknown, describedBy?: string) {
  const generated = useId();
  const controlId = id ?? generated;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const ariaDescribedBy = [describedBy, errorId, helpId].filter(Boolean).join(" ") || undefined;
  return { controlId, helpId, errorId, ariaDescribedBy };
}

function FieldChrome({
  controlId,
  label,
  help,
  error,
  helpId,
  errorId,
  required,
  wrapperClassName,
  children,
}: FieldChromeProps & {
  controlId: string;
  helpId?: string;
  errorId?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  if (!label && !help && !error) return <>{children}</>;
  return (
    <div className={cn("space-y-1.5", wrapperClassName)}>
      {label && (
        <Label htmlFor={controlId}>
          {label}
          {required && (
            <span className="ml-0.5 text-fg-muted" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}
      {children}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
      {help && (
        <p id={helpId} className="text-xs text-fg-muted">
          {help}
        </p>
      )}
    </div>
  );
}

export const controlClasses = cn(
  "w-full rounded-md border border-border-strong bg-surface text-[13px] text-fg placeholder:text-fg-subtle",
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-danger",
  focusRing,
  "focus-visible:ring-offset-0 focus-visible:border-accent"
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, FieldChromeProps {
  /** Decorative icon rendered inside the left edge of the input. */
  leadingIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { id, label, help, error, wrapperClassName, leadingIcon, className, required, "aria-describedby": describedBy, ...props },
  ref
) {
  const ids = useFieldIds(id, help, error, describedBy);
  const input = (
    <input
      ref={ref}
      id={ids.controlId}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.ariaDescribedBy}
      className={cn(controlClasses, "h-8 px-2.5", Boolean(leadingIcon) && "pl-8", className)}
      {...props}
    />
  );
  return (
    <FieldChrome {...ids} label={label} help={help} error={error} required={required} wrapperClassName={wrapperClassName}>
      {leadingIcon ? (
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-fg-subtle [&_svg]:h-3.5 [&_svg]:w-3.5"
            aria-hidden="true"
          >
            {leadingIcon}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
    </FieldChrome>
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, FieldChromeProps {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, help, error, wrapperClassName, className, required, children, "aria-describedby": describedBy, ...props },
  ref
) {
  const ids = useFieldIds(id, help, error, describedBy);
  return (
    <FieldChrome {...ids} label={label} help={help} error={error} required={required} wrapperClassName={wrapperClassName}>
      <select
        ref={ref}
        id={ids.controlId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.ariaDescribedBy}
        className={cn(controlClasses, "h-8 pl-2.5 pr-8", className)}
        {...props}
      >
        {children}
      </select>
    </FieldChrome>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChromeProps {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { id, label, help, error, wrapperClassName, className, required, "aria-describedby": describedBy, ...props },
  ref
) {
  const ids = useFieldIds(id, help, error, describedBy);
  return (
    <FieldChrome {...ids} label={label} help={help} error={error} required={required} wrapperClassName={wrapperClassName}>
      <textarea
        ref={ref}
        id={ids.controlId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.ariaDescribedBy}
        className={cn(controlClasses, "min-h-20 px-2.5 py-2", className)}
        {...props}
      />
    </FieldChrome>
  );
});

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  /** Secondary text under the label. */
  description?: React.ReactNode;
  error?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { id, label, description, error, className, "aria-describedby": describedBy, ...props },
  ref
) {
  const ids = useFieldIds(id, description, error, describedBy);
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        ref={ref}
        id={ids.controlId}
        type="checkbox"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.ariaDescribedBy}
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-sm accent-[rgb(var(--color-accent))]",
          focusRing,
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        {...props}
      />
      <div className="min-w-0 text-[13px]">
        <label htmlFor={ids.controlId} className="cursor-pointer font-medium text-fg">
          {label}
        </label>
        {description && (
          <p id={ids.helpId} className="text-xs text-fg-muted">
            {description}
          </p>
        )}
        {error && (
          <p id={ids.errorId} className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
});

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function Switch({ id, checked, onCheckedChange, label, description, className, disabled, ...props }: SwitchProps) {
  const ids = useFieldIds(id, description, undefined);
  const labelId = `${ids.controlId}-label`;
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0 text-[13px]">
        <span id={labelId} className="font-medium text-fg">
          {label}
        </span>
        {description && (
          <p id={ids.helpId} className="text-xs text-fg-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={ids.controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={ids.ariaDescribedBy}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "border-accent bg-accent" : "border-border-strong bg-muted",
          focusRing
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
