"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Tags, Trash2 } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { createEntityId } from "@/features/tournament/application/entities";
import {
  effectiveSpeakerCategories,
  newSpeakerCategory,
  slugifyCategory,
  speakersInCategory,
  toStoredSpeakerCategories,
  validateSpeakerCategories,
  type SpeakerCategoryView,
} from "@/lib/speakerCategories";

/**
 * Speaker categories (ESL, novice, …) as Tabbycat has them: a name, a slug, whether the category
 * gets its own public speaker tab, and an optional limit on how many ranks that tab shows.
 */
export default function SpeakerCategoriesPage() {
  const { t, plural } = useI18n();
  const { tournament, teams, isOwnerOrAdmin, saveTournament } = useTournament();
  const saved = useMemo(
    () => effectiveSpeakerCategories(tournament?.preferences.speakerCategories, teams),
    [tournament?.preferences.speakerCategories, teams]
  );
  const [draft, setDraft] = useState<SpeakerCategoryView[] | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const categories = draft ?? saved;
  const errors = validateSpeakerCategories(categories);
  const unsaved = categories.filter((category) => category.unsaved).length;
  const dirty = draft !== null || unsaved > 0;

  const update = (id: string, change: Partial<SpeakerCategoryView>) =>
    setDraft(categories.map((category) => (category.id === id ? { ...category, ...change } : category)));
  const move = (index: number, offset: number) => {
    const next = [...categories];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    setDraft(next.map((category, position) => ({ ...category, seq: position + 1 })));
  };
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setDraft([...categories, newSpeakerCategory(newName, categories, () => createEntityId("spkcat"))]);
    setNewName("");
  };

  const save = async () => {
    if (!tournament || errors.length > 0 || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveTournament({
        ...tournament,
        preferences: { ...tournament.preferences, speakerCategories: toStoredSpeakerCategories(categories) },
      });
      setDraft(null);
      setMessage({ tone: "success", text: t("setup.importsExtra.speakerCategories.saved") });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("setup.importsExtra.speakerCategories.saveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("setup.importsExtra.speakerCategories.title")}
        description={t("setup.importsExtra.speakerCategories.description")}
        actions={
          isOwnerOrAdmin && (
            <Button
              variant="primary"
              onClick={save}
              disabled={!dirty || errors.length > 0}
              loading={saving}
              loadingText={t("setup.common.saving")}
            >
              {t("setup.importsExtra.speakerCategories.save")}
            </Button>
          )
        }
      />

      {unsaved > 0 && (
        <Alert tone="info" title={plural("setup.importsExtra.speakerCategories.fromLabelsTitle", unsaved)}>
          {t("setup.importsExtra.speakerCategories.fromLabelsBody")}
        </Alert>
      )}
      {errors.length > 0 && (
        // Validation messages come from lib/speakerCategories and are shown as they are (English).
        <Alert tone="danger" role="alert" title={t("setup.importsExtra.speakerCategories.fixErrors")}>
          <ul className="list-disc ps-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </Alert>
      )}
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>{t("setup.importsExtra.speakerCategories.order")}</TH>
              <TH>{t("setup.common.name")}</TH>
              <TH>{t("setup.importsExtra.speakerCategories.slug")}</TH>
              <TH align="center">{t("setup.importsExtra.speakerCategories.publicTab")}</TH>
              <TH align="right">{t("setup.importsExtra.speakerCategories.publicLimit")}</TH>
              <TH align="right">{t("setup.importsExtra.speakerCategories.speakers")}</TH>
              <TH align="right">
                <span className="sr-only">{t("setup.common.actions")}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {categories.length === 0 && (
              <TableEmpty colSpan={7}>{t("setup.importsExtra.speakerCategories.empty")}</TableEmpty>
            )}
            {categories.map((category, index) => {
              const speakers = speakersInCategory(teams, category.id, categories);
              return (
                <TR key={category.id}>
                  <TD className="whitespace-nowrap">
                    <IconButton
                      size="sm"
                      label={t("setup.importsExtra.speakerCategories.moveUp", { name: category.name })}
                      icon={<ArrowUp />}
                      disabled={!isOwnerOrAdmin || index === 0}
                      onClick={() => move(index, -1)}
                    />
                    <IconButton
                      size="sm"
                      label={t("setup.importsExtra.speakerCategories.moveDown", { name: category.name })}
                      icon={<ArrowDown />}
                      disabled={!isOwnerOrAdmin || index === categories.length - 1}
                      onClick={() => move(index, 1)}
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={t("setup.importsExtra.speakerCategories.nameOf", { name: category.name })}
                      value={category.name}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { name: event.target.value })}
                    />
                    {category.unsaved && (
                      <StatusPill tone="info" className="mt-1">
                        {t("setup.importsExtra.speakerCategories.fromLabels")}
                      </StatusPill>
                    )}
                  </TD>
                  <TD className="w-40">
                    <Input
                      aria-label={t("setup.importsExtra.speakerCategories.slugOf", { name: category.name })}
                      value={category.slug}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { slug: slugifyCategory(event.target.value) })}
                    />
                  </TD>
                  <TD align="center">
                    <input
                      type="checkbox"
                      aria-label={t("setup.importsExtra.speakerCategories.publicTabFor", { name: category.name })}
                      checked={category.public}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { public: event.target.checked })}
                      className={cn(
                        "h-4 w-4 cursor-pointer rounded-sm accent-[rgb(var(--color-accent))] disabled:cursor-not-allowed disabled:opacity-50",
                        focusRing
                      )}
                    />
                  </TD>
                  <TD align="right" className="w-28">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      aria-label={t("setup.importsExtra.speakerCategories.publicLimitFor", { name: category.name })}
                      value={category.limit ?? 0}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { limit: event.target.value === "" ? undefined : Number(event.target.value) })}
                    />
                  </TD>
                  <TD numeric>{speakers}</TD>
                  <TD align="right">
                    {isOwnerOrAdmin && (
                      <IconButton
                        size="sm"
                        label={
                          speakers > 0
                            ? t("setup.importsExtra.speakerCategories.hasSpeakers", { name: category.name })
                            : t("setup.importsExtra.speakerCategories.deleteCategory", { name: category.name })
                        }
                        icon={<Trash2 />}
                        disabled={speakers > 0}
                        onClick={() => setDraft(categories.filter((item) => item.id !== category.id))}
                      />
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableContainer>

      {isOwnerOrAdmin && (
        <form onSubmit={add} className="flex max-w-md items-end gap-2">
          <Input
            label={t("setup.importsExtra.speakerCategories.newCategory")}
            value={newName}
            placeholder={t("setup.importsExtra.speakerCategories.newCategoryPlaceholder")}
            onChange={(event) => setNewName(event.target.value)}
            wrapperClassName="flex-1"
          />
          <Button type="submit" disabled={!newName.trim()}>
            <Plus aria-hidden="true" />
            {t("setup.common.add")}
          </Button>
        </form>
      )}
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Tags className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("setup.importsExtra.speakerCategories.footnote")}
      </p>
    </div>
  );
}
