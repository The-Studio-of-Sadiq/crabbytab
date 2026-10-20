"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Tags, Trash2 } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
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
      setMessage({ tone: "success", text: "Speaker categories saved." });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not save the categories." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Speaker categories"
        description="Categories such as ESL or Novice. Speakers are assigned on the Teams page or by CSV (speakerN_categories). A public category gets its own speaker tab once the speaker tab is released; break categories can derive eligibility from these on the Break page."
        actions={
          isOwnerOrAdmin && (
            <Button variant="primary" onClick={save} disabled={!dirty || errors.length > 0} loading={saving} loadingText="Saving…">
              Save categories
            </Button>
          )
        }
      />

      {unsaved > 0 && (
        <Alert tone="info" title={`${unsaved} categor${unsaved === 1 ? "y comes" : "ies come"} from older speaker labels`}>
          They already work for filters and eligibility. Save to keep them as categories you can rename and publish.
        </Alert>
      )}
      {errors.length > 0 && (
        <Alert tone="danger" role="alert" title="Fix these before saving">
          <ul className="list-disc pl-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </Alert>
      )}
      {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Alert>}

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>Order</TH>
              <TH>Name</TH>
              <TH>Slug</TH>
              <TH align="center">Public tab</TH>
              <TH align="right">Public limit</TH>
              <TH align="right">Speakers</TH>
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {categories.length === 0 && (
              <TableEmpty colSpan={7}>No speaker categories yet. Add one below or import teams with speaker categories.</TableEmpty>
            )}
            {categories.map((category, index) => {
              const speakers = speakersInCategory(teams, category.id, categories);
              return (
                <TR key={category.id}>
                  <TD className="whitespace-nowrap">
                    <IconButton size="sm" label={`Move ${category.name} up`} icon={<ArrowUp />} disabled={!isOwnerOrAdmin || index === 0} onClick={() => move(index, -1)} />
                    <IconButton size="sm" label={`Move ${category.name} down`} icon={<ArrowDown />} disabled={!isOwnerOrAdmin || index === categories.length - 1} onClick={() => move(index, 1)} />
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Name of ${category.name}`}
                      value={category.name}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { name: event.target.value })}
                    />
                    {category.unsaved && <StatusPill tone="info" className="mt-1">From labels, not saved</StatusPill>}
                  </TD>
                  <TD className="w-40">
                    <Input
                      aria-label={`Slug of ${category.name}`}
                      value={category.slug}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { slug: slugifyCategory(event.target.value) })}
                    />
                  </TD>
                  <TD align="center">
                    <input
                      type="checkbox"
                      aria-label={`Public speaker tab for ${category.name}`}
                      checked={category.public}
                      disabled={!isOwnerOrAdmin}
                      onChange={(event) => update(category.id, { public: event.target.checked })}
                    />
                  </TD>
                  <TD align="right" className="w-28">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      aria-label={`Public limit for ${category.name} (0 = no limit)`}
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
                        label={speakers > 0 ? `${category.name} has speakers; remove them first` : `Delete ${category.name}`}
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
          <Input label="New category" value={newName} placeholder="e.g. ESL" onChange={(event) => setNewName(event.target.value)} wrapperClassName="flex-1" />
          <Button type="submit" disabled={!newName.trim()}>
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>
      )}
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Tags className="h-3.5 w-3.5" aria-hidden="true" />
        Public limit: the category tab shows speakers ranked up to this number (0 shows everyone). Deleting is only possible once no speaker is in the category.
      </p>
    </div>
  );
}
