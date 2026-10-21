"use client";

import React, { useMemo, useState } from "react";
import type { Venue, VenueCategoryInfo } from "@/types";
import { normaliseCategory, venueCategoryInfo, venueCategoryNames, venueDisplayName } from "@/lib/venues/venues";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

/**
 * Display options per room category (Tabbycat VenueCategory): a description shown as the room's
 * tooltip, whether the category is prefixed or suffixed to room names in the draw, and whether
 * the description is shown on public pages.
 */
export function VenueCategoriesEditor({
  venues,
  categories,
  onSave,
}: {
  venues: Venue[];
  categories: VenueCategoryInfo[] | undefined;
  onSave(next: VenueCategoryInfo[]): Promise<void>;
}) {
  const { t } = useI18n();
  const names = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const venue of venues) {
      for (const name of venueCategoryNames(venue)) {
        if (!byKey.has(normaliseCategory(name))) byKey.set(normaliseCategory(name), name);
      }
    }
    for (const category of categories ?? []) {
      if (!byKey.has(normaliseCategory(category.name))) byKey.set(normaliseCategory(category.name), category.name);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [venues, categories]);
  const [draft, setDraft] = useState<Record<string, VenueCategoryInfo>>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (names.length === 0) return null;

  const current = (name: string): VenueCategoryInfo =>
    draft[normaliseCategory(name)] ?? venueCategoryInfo(categories, name) ?? { name, displayInName: "none" };
  const change = (name: string, patch: Partial<VenueCategoryInfo>) => {
    setStatus(null);
    setDraft((value) => ({ ...value, [normaliseCategory(name)]: { ...current(name), ...patch, name } }));
  };
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const merged = new Map((categories ?? []).map((category) => [normaliseCategory(category.name), category]));
      for (const [key, value] of Object.entries(draft)) {
        merged.set(key, {
          name: value.name,
          ...(value.description?.trim() ? { description: value.description.trim() } : {}),
          displayInName: value.displayInName ?? "none",
          ...(value.publicTooltip ? { publicTooltip: true } : {}),
        });
      }
      await onSave([...merged.values()]);
      setDraft({});
      setStatus({ tone: "success", text: t("setup.importsExtra.venueCategories.saved") });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : t("setup.importsExtra.venueCategories.saveError") });
    } finally {
      setSaving(false);
    }
  };

  const example = venues.find((venue) => venueCategoryNames(venue).length > 0);
  return (
    <Card>
      <CardHeader
        title={t("setup.importsExtra.venueCategories.title")}
        description={t("setup.importsExtra.venueCategories.description")}
      />
      <CardBody className="space-y-3">
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH>{t("setup.importsExtra.venueCategories.category")}</TH>
                <TH>{t("setup.importsExtra.venueCategories.descriptionColumn")}</TH>
                <TH>{t("setup.importsExtra.venueCategories.inRoomName")}</TH>
                <TH align="center">{t("setup.importsExtra.venueCategories.publicTooltip")}</TH>
              </TR>
            </THead>
            <TBody>
              {names.map((name) => {
                const info = current(name);
                return (
                  <TR key={name}>
                    <TD className="font-semibold">{name}</TD>
                    <TD>
                      <Input
                        aria-label={t("setup.importsExtra.venueCategories.descriptionOf", { name })}
                        value={info.description ?? ""}
                        maxLength={200}
                        placeholder={t("setup.importsExtra.venueCategories.descriptionPlaceholder")}
                        onChange={(event) => change(name, { description: event.target.value })}
                        className="h-7 min-w-40 text-xs"
                      />
                    </TD>
                    <TD>
                      <Select
                        aria-label={t("setup.importsExtra.venueCategories.shownInNames", { name })}
                        value={info.displayInName ?? "none"}
                        onChange={(event) => change(name, { displayInName: event.target.value as VenueCategoryInfo["displayInName"] })}
                        className="h-7 w-auto text-xs"
                      >
                        <option value="none">{t("setup.importsExtra.venueCategories.notShown")}</option>
                        <option value="prefix">{t("setup.importsExtra.venueCategories.prefix")}</option>
                        <option value="suffix">{t("setup.importsExtra.venueCategories.suffix")}</option>
                      </Select>
                    </TD>
                    <TD align="center">
                      <input
                        type="checkbox"
                        aria-label={t("setup.importsExtra.venueCategories.showPublic", { name })}
                        checked={info.publicTooltip === true}
                        onChange={(event) => change(name, { publicTooltip: event.target.checked })}
                        className={cn("h-4 w-4 cursor-pointer rounded-sm accent-[rgb(var(--color-accent))]", focusRing)}
                      />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" onClick={save} disabled={!dirty} loading={saving} loadingText={t("setup.common.saving")}>
            {t("setup.importsExtra.venueCategories.save")}
          </Button>
          {example && (
            <span className="text-xs text-fg-muted">
              {t("setup.importsExtra.venueCategories.example", {
                name: venueDisplayName(example, Object.keys(draft).length ? names.map(current) : categories),
              })}
            </span>
          )}
          {status && (
            <span
              role={status.tone === "error" ? "alert" : "status"}
              className={cn("text-xs", status.tone === "error" ? "text-danger" : "text-success")}
            >
              {status.text}
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
