"use client";

import React, { useState, useMemo, useRef } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { parseMotionsCsv } from "@/lib/csv/importer";
import { CheckCircle2, Edit2, Lightbulb, Lock, Plus, Search, Trash2, Upload } from "lucide-react";
import { Motion } from "@/types";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { RoundMotionsPanel } from "@/features/tournament/components/RoundMotionsPanel";
import { MotionSettingsCard } from "@/features/tournament/components/MotionSettingsCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";

/** CSV template shown as the placeholder; column names are parsed back, so they stay in English. */
const CSV_EXAMPLE =
  "text,reference,infoslide,round\n\"This House would ban algorithmic feeds.\",\"R1: Tech\",\"Chronological feeds only.\",\"Round 1\"\n\"This House regrets the glorification of work ethic.\",\"R2: Culture\",\"\",\"Round 2\"";
const CSV_COLUMNS = "text, reference, infoslide, round";

const CREATE_FORM_ID = "create-motion-form";
const EDIT_FORM_ID = "edit-motion-form";

export default function MotionsPage() {
  const { t, rich, formatList } = useI18n();
  const { tournament, motions, rounds, addMotion, addMotions, updateMotion, deleteMotion } = useTournament();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterRoundId, setFilterRoundId] = useState("");

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMotion, setEditingMotion] = useState<Motion | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [isImportingMotions, setIsImportingMotions] = useState(false);
  const [csvImportError, setCsvImportError] = useState("");
  const [motionPendingDelete, setMotionPendingDelete] = useState<Motion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // New Motion Form State
  const [newText, setNewText] = useState("");
  const [newInfoSlide, setNewInfoSlide] = useState("");
  const [newRef, setNewRef] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [motionPendingRelease, setMotionPendingRelease] = useState<Motion | null>(null);

  const filteredMotions = useMemo(() => {
    return motions.filter((m) => {
      const matchesSearch =
        m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.reference || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.infoSlide || "").toLowerCase().includes(searchQuery.toLowerCase());

      const matchesRound = !filterRoundId || (m.rounds && m.rounds.includes(filterRoundId));

      return matchesSearch && matchesRound;
    });
  }, [motions, searchQuery, filterRoundId]);

  // Create Motion (Private by default)
  const handleCreateMotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    await addMotion({
      text: newText.trim(),
      infoSlide: newInfoSlide.trim() || undefined,
      // Saved to the record, so it stays in English for every viewer.
      reference: newRef.trim() || `Motion ${motions.length + 1}`,
      rounds: selectedRoundId ? [selectedRoundId] : [],
      released: false, // Don't make them public by default!
      seq: motions.length + 1,
    });

    setNewText("");
    setNewInfoSlide("");
    setNewRef("");
    setSelectedRoundId("");
    setShowAddModal(false);
  };

  // Update Motion
  const handleUpdateMotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMotion || !editingMotion.text.trim()) return;

    await updateMotion(editingMotion);
    setEditingMotion(null);
  };

  // Toggle Release
  const toggleMotionRelease = async (motion: Motion) => {
    setMotionPendingRelease(motion);
  };

  const confirmDelete = async () => {
    if (!motionPendingDelete) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteMotion(motionPendingDelete.id);
      setMotionPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("setup.importsExtra.motions.deleteError"));
    } finally {
      setIsDeleting(false);
    }
  };

  // CSV File Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCsvText(content);
      }
    };
    reader.readAsText(file);
  };

  // CSV Import Process
  const handleCsvImport = async () => {
    if (!csvText.trim()) return;

    setIsImportingMotions(true);
    setCsvImportError("");
    try {
      const parsedMotions = parseMotionsCsv(csvText, tournament?.id || "", rounds);
      await addMotions(parsedMotions.map((motion, idx) => ({
        text: motion.text,
        infoSlide: motion.infoSlide,
        reference: motion.reference,
        rounds: motion.rounds,
        released: false,
        seq: motions.length + idx + 1,
      })));

      setCsvText("");
      setSelectedFileName("");
      setShowCsvModal(false);
    } catch (error) {
      // Parser messages are shown as they are (English).
      setCsvImportError(error instanceof Error ? error.message : t("setup.importsExtra.motions.csvError"));
    } finally {
      setIsImportingMotions(false);
    }
  };

  const closeCsvModal = () => {
    setShowCsvModal(false);
    setCsvText("");
    setSelectedFileName("");
  };

  const pendingReleaseName = motionPendingRelease?.reference;
  const releaseDescription = motionPendingRelease?.released
    ? pendingReleaseName
      ? t("setup.importsExtra.motions.unpublishDescriptionNamed", { name: pendingReleaseName })
      : t("setup.importsExtra.motions.unpublishDescription")
    : pendingReleaseName
      ? t("setup.importsExtra.motions.publishDescriptionNamed", { name: pendingReleaseName })
      : t("setup.importsExtra.motions.publishDescription");

  const strong = { b: (text: string) => <strong className="font-semibold text-fg">{text}</strong> };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("setup.importsExtra.motions.title")}
        description={t("setup.importsExtra.motions.description")}
        actions={
          <>
            <Button onClick={() => setShowCsvModal(true)}>
              <Upload aria-hidden="true" />
              {t("setup.importsExtra.motions.uploadCsv")}
            </Button>
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              <Plus aria-hidden="true" />
              {t("setup.importsExtra.motions.addMotion")}
            </Button>
          </>
        }
      />

      {/* Filters & Search */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <Select
          aria-label={t("setup.importsExtra.motions.filterRound")}
          value={filterRoundId}
          onChange={(e) => setFilterRoundId(e.target.value)}
          wrapperClassName="sm:w-56"
        >
          <option value="">{t("setup.importsExtra.motions.allRounds")}</option>
          {rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>

        <Input
          type="search"
          aria-label={t("setup.importsExtra.motions.search")}
          placeholder={t("setup.importsExtra.motions.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leadingIcon={<Search />}
          wrapperClassName="w-full sm:w-64"
        />
      </div>

      {filterRoundId && rounds.some((round) => round.id === filterRoundId) && (
        <RoundMotionsPanel round={rounds.find((round) => round.id === filterRoundId)!} />
      )}

      {/* Motions List */}
      <div className="space-y-4">
        {filteredMotions.map((motion, idx) => {
          const assignedRounds = rounds.filter((r) => motion.rounds && motion.rounds.includes(r.id));
          const label = motion.reference || t("setup.importsExtra.motions.fallbackReference", { number: idx + 1 });

          return (
            <Card key={motion.id} className="p-4">
              <div className="mb-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{label}</Badge>
                  {assignedRounds.length > 0 ? (
                    <Badge>
                      {t("setup.importsExtra.motions.allocatedTo", { rounds: formatList(assignedRounds.map((round) => round.name)) })}
                    </Badge>
                  ) : (
                    <span className="text-xs italic text-fg-muted">{t("setup.importsExtra.motions.unassigned")}</span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {/* Public release toggle */}
                  <Button size="sm" onClick={() => toggleMotionRelease(motion)}>
                    {motion.released ? (
                      <>
                        <CheckCircle2 className="text-success" aria-hidden="true" />
                        {t("setup.importsExtra.motions.released")}
                      </>
                    ) : (
                      <>
                        <Lock className="text-fg-subtle" aria-hidden="true" />
                        {t("setup.importsExtra.motions.release")}
                      </>
                    )}
                  </Button>

                  <IconButton
                    size="sm"
                    label={t("setup.importsExtra.motions.edit", { name: label })}
                    icon={<Edit2 />}
                    onClick={() => setEditingMotion(motion)}
                  />

                  <IconButton
                    size="sm"
                    label={t("setup.importsExtra.motions.delete", { name: label })}
                    icon={<Trash2 />}
                    onClick={() => {
                      setDeleteError("");
                      setMotionPendingDelete(motion);
                    }}
                  />
                </div>
              </div>

              {/* Motion text */}
              <blockquote className="my-3 border-s-4 border-accent ps-3 text-base font-semibold text-fg">
                &ldquo;{motion.text}&rdquo;
              </blockquote>

              {/* Info slide if present */}
              {motion.infoSlide && (
                <div className="mt-3 rounded-md border border-border bg-muted/50 p-3 text-xs text-fg">
                  <strong className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                    {t("setup.importsExtra.motions.infoslide")}
                  </strong>
                  <p className="whitespace-pre-line">{motion.infoSlide}</p>
                </div>
              )}
            </Card>
          );
        })}

        {filteredMotions.length === 0 && (
          <EmptyState
            icon={<Lightbulb />}
            title={t("setup.importsExtra.motions.emptyTitle")}
            description={t("setup.importsExtra.motions.emptyDescription")}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" onClick={() => setShowAddModal(true)}>
                  <Plus aria-hidden="true" />
                  {t("setup.importsExtra.motions.addMotion")}
                </Button>
                <Button onClick={() => setShowCsvModal(true)}>
                  <Upload aria-hidden="true" />
                  {t("setup.importsExtra.motions.uploadCsv")}
                </Button>
              </div>
            }
          />
        )}
      </div>

      {/* Add motion */}
      <Dialog
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        size="lg"
        title={t("setup.importsExtra.motions.createTitle")}
        icon={<Lightbulb className="text-fg-subtle" aria-hidden="true" />}
        footer={
          <>
            <Button onClick={() => setShowAddModal(false)}>{t("setup.common.cancel")}</Button>
            <Button type="submit" form={CREATE_FORM_ID} variant="primary">
              {t("setup.importsExtra.motions.save")}
            </Button>
          </>
        }
      >
        <form id={CREATE_FORM_ID} onSubmit={handleCreateMotion} className="space-y-4">
          <Input
            label={t("setup.importsExtra.motions.referenceLabel")}
            type="text"
            placeholder={t("setup.importsExtra.motions.referencePlaceholder")}
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
          />
          <Textarea
            label={t("setup.importsExtra.motions.textLabel")}
            rows={3}
            required
            placeholder={t("setup.importsExtra.motions.textPlaceholder")}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            className="font-medium"
          />
          <Textarea
            label={t("setup.importsExtra.motions.infoslideLabel")}
            help={t("setup.importsExtra.motions.infoslideHelp")}
            rows={2}
            placeholder={t("setup.importsExtra.motions.infoslidePlaceholder")}
            value={newInfoSlide}
            onChange={(e) => setNewInfoSlide(e.target.value)}
          />
          <Select
            label={t("setup.importsExtra.motions.roundLabel")}
            help={t("setup.common.optional")}
            value={selectedRoundId}
            onChange={(e) => setSelectedRoundId(e.target.value)}
          >
            <option value="">{t("setup.importsExtra.motions.noRound")}</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Alert tone="info">{rich("setup.importsExtra.motions.privateNote", strong)}</Alert>
        </form>
      </Dialog>

      {/* Edit motion */}
      <Dialog
        open={editingMotion !== null}
        onClose={() => setEditingMotion(null)}
        size="lg"
        title={t("setup.importsExtra.motions.editTitle")}
        icon={<Edit2 className="text-fg-subtle" aria-hidden="true" />}
        footer={
          <>
            <Button onClick={() => setEditingMotion(null)}>{t("setup.common.cancel")}</Button>
            <Button type="submit" form={EDIT_FORM_ID} variant="primary">
              {t("setup.common.saveChanges")}
            </Button>
          </>
        }
      >
        {editingMotion && (
          <form id={EDIT_FORM_ID} onSubmit={handleUpdateMotion} className="space-y-4">
            <Input
              label={t("setup.importsExtra.motions.referenceLabel")}
              type="text"
              value={editingMotion.reference || ""}
              onChange={(e) => setEditingMotion({ ...editingMotion, reference: e.target.value })}
            />
            <Textarea
              label={t("setup.importsExtra.motions.textLabel")}
              rows={3}
              required
              value={editingMotion.text}
              onChange={(e) => setEditingMotion({ ...editingMotion, text: e.target.value })}
              className="font-medium"
            />
            <Textarea
              label={t("setup.importsExtra.motions.infoslideLabel")}
              help={t("setup.importsExtra.motions.infoslideHelp")}
              rows={3}
              value={editingMotion.infoSlide || ""}
              onChange={(e) => setEditingMotion({ ...editingMotion, infoSlide: e.target.value })}
            />
            <fieldset aria-describedby="motion-rounds-help">
              <legend className="mb-1.5 block text-xs font-medium text-fg">{t("setup.importsExtra.motions.assignedRounds")}</legend>
              <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                {rounds.map((r) => (
                  <Checkbox
                    key={r.id}
                    label={r.name}
                    checked={Boolean(editingMotion.rounds?.includes(r.id))}
                    onChange={(e) => {
                      const current = editingMotion.rounds || [];
                      const next = e.target.checked ? [...current, r.id] : current.filter((id) => id !== r.id);
                      const roundSeq = { ...editingMotion.roundSeq };
                      if (!e.target.checked) delete roundSeq[r.id];
                      setEditingMotion({ ...editingMotion, rounds: next, roundSeq });
                    }}
                  />
                ))}
              </div>
              <p id="motion-rounds-help" className="mt-1 text-xs text-fg-muted">
                {t("setup.importsExtra.motions.assignedRoundsHelp")}
              </p>
            </fieldset>
          </form>
        )}
      </Dialog>

      {/* CSV upload / import */}
      <Dialog
        open={showCsvModal}
        onClose={closeCsvModal}
        size="lg"
        title={t("setup.importsExtra.motions.csvTitle")}
        description={
          <>
            {t("setup.importsExtra.motions.csvDescription")} <code className="font-mono text-fg">{CSV_COLUMNS}</code>
          </>
        }
        icon={<Upload className="text-fg-subtle" aria-hidden="true" />}
        footer={
          <>
            <Button onClick={closeCsvModal}>{t("setup.common.cancel")}</Button>
            <Button
              variant="primary"
              onClick={handleCsvImport}
              disabled={!csvText.trim()}
              loading={isImportingMotions}
              loadingText={t("setup.importsExtra.csv.importing")}
            >
              {t("setup.importsExtra.motions.importMotions")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" />
              {t("setup.importsExtra.csv.chooseFile")}
            </Button>
            <span className="max-w-[200px] truncate text-xs text-fg-muted">
              {selectedFileName || t("setup.importsExtra.motions.noFile")}
            </span>
          </div>

          <Textarea
            label={t("setup.importsExtra.motions.csvPaste")}
            rows={6}
            placeholder={CSV_EXAMPLE}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setCsvImportError("");
            }}
            className="font-mono text-xs"
          />

          {csvImportError && (
            <Alert tone="danger" role="alert">
              {csvImportError}
            </Alert>
          )}

          <Alert tone="info">{rich("setup.importsExtra.motions.csvPrivateNote", strong)}</Alert>
        </div>
      </Dialog>

      <MotionSettingsCard />

      {motionPendingRelease && (
        <ReleaseActionDialog
          title={
            motionPendingRelease.released
              ? t("setup.importsExtra.motions.unpublishTitle")
              : t("setup.importsExtra.motions.publishTitle")
          }
          description={releaseDescription}
          confirmLabel={
            motionPendingRelease.released
              ? t("setup.importsExtra.motions.unpublish")
              : t("setup.importsExtra.motions.publish")
          }
          apply={() => updateMotion({ ...motionPendingRelease, released: !motionPendingRelease.released })}
          onClose={() => setMotionPendingRelease(null)}
        />
      )}

      {motionPendingDelete && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.importsExtra.motions.deleteTitle", {
            name: motionPendingDelete.reference || `${motionPendingDelete.text.substring(0, 30)}…`,
          })}
          description={t("setup.importsExtra.motions.deleteDescription")}
          confirmLabel={t("setup.common.delete")}
          isBusy={isDeleting}
          error={deleteError || undefined}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setMotionPendingDelete(null)}
        />
      )}
    </div>
  );
}
