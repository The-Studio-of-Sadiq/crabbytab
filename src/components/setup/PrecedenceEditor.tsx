"use client";

import React from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { IconButton } from "@/components/ui/Button";
import { Checkbox, Select } from "@/components/ui/Field";

const MAX_METRICS = 8;

/**
 * Ordered list editor for a standings precedence chain: add, remove, and
 * reorder metric ids. Used for both team and speaker precedence.
 */
export function PrecedenceEditor<M extends string>({
  value,
  onChange,
  labels,
  disabledIds = [],
  repeatableIds = [],
}: {
  value: M[];
  onChange: (next: M[]) => void;
  labels: Record<M, string>;
  /** Metrics greyed out in the "add" list (e.g. BP-only metrics in a two-team tournament). */
  disabledIds?: M[];
  /** Metrics that may be added more than once (who-beat-whom). */
  repeatableIds?: M[];
}) {
  const { t } = useI18n();
  const allIds = Object.keys(labels) as M[];
  const repeatable = new Set(repeatableIds);
  const available = allIds.filter((id) => repeatable.has(id) || !value.includes(id));
  const disabledSet = new Set(disabledIds);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...value];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = (id: M) => {
    if (value.length >= MAX_METRICS || (value.includes(id) && !repeatable.has(id))) return;
    onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-xs italic text-fg-muted">{t("setup.wizard.precedenceEmpty")}</p>}
      <ol className="space-y-1.5">
        {value.map((id, i) => {
          const metric = labels[id] ?? id;
          return (
            <li
              key={`${id}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-fg-muted"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="font-medium text-fg">{metric}</span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <IconButton
                  size="sm"
                  label={t("setup.wizard.precedenceMoveUp", { metric })}
                  icon={<ArrowUp aria-hidden="true" />}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                />
                <IconButton
                  size="sm"
                  label={t("setup.wizard.precedenceMoveDown", { metric })}
                  icon={<ArrowDown aria-hidden="true" />}
                  disabled={i === value.length - 1}
                  onClick={() => move(i, 1)}
                />
                <IconButton
                  size="sm"
                  label={t("setup.wizard.precedenceRemove", { metric })}
                  icon={<X aria-hidden="true" />}
                  onClick={() => remove(i)}
                  className="hover:text-danger"
                />
              </span>
            </li>
          );
        })}
      </ol>

      {value.length < MAX_METRICS && available.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Select
            aria-label={t("setup.wizard.precedenceAddLabel")}
            className="min-w-0 flex-1 text-xs"
            value=""
            onChange={(e) => e.target.value && add(e.target.value as M)}
          >
            <option value="" disabled>
              {t("setup.wizard.precedenceAdd")}
            </option>
            {available.map((id) => (
              <option key={id} value={id} disabled={disabledSet.has(id)}>
                {disabledSet.has(id) ? t("setup.wizard.precedenceNotApplicable", { metric: labels[id] }) : labels[id]}
              </option>
            ))}
          </Select>
          <Plus className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
        </div>
      )}
      <p className="text-xs text-fg-muted">{t("setup.wizard.precedenceLimit", { max: MAX_METRICS })}</p>
    </div>
  );
}

/** Unordered set editor for "extra" metrics shown on the standings page but not used to rank. */
export function ExtraMetricsEditor<M extends string>({
  value,
  onChange,
  labels,
  exclude = [],
}: {
  value: M[];
  onChange: (next: M[]) => void;
  labels: Record<M, string>;
  /** Metrics already in the precedence chain, hidden here to avoid double-listing. */
  exclude?: M[];
}) {
  const excludeSet = new Set(exclude);
  const options = (Object.keys(labels) as M[]).filter((id) => !excludeSet.has(id));

  const toggle = (id: M) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((id) => (
        <Checkbox key={id} label={labels[id]} checked={value.includes(id)} onChange={() => toggle(id)} />
      ))}
    </div>
  );
}
