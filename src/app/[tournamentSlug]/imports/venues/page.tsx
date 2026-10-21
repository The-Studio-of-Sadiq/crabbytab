"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { parseVenuesCsv } from "@/lib/csv/importer";
import { CheckCircle2, ExternalLink, MapPin, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { Venue } from "@/types";
import {
  isVenueAvailableForRound,
  parseVenueCategoryList,
  safeVenueUrl,
  setVenueRoundAvailability,
  venueCategoryNames,
  venueTooltip,
  withVenueCategories,
} from "@/lib/venues/venues";
import { VenueCategoriesEditor } from "@/features/tournament/components/VenueCategoriesEditor";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

/** CSV template shown as the placeholder; column names are parsed back, so they stay in English. */
const CSV_EXAMPLE =
  "name,priority,category,capacity,accessible,online\nLecture Theatre 1,20,Main,200,yes,no\nSeminar Room A,10,General,30,no,no\nOnline Room 1,5,Online,50,yes,yes";

const VENUE_FORM_ID = "venue-form";

export default function VenuesPage() {
  const { t, plural, rich } = useI18n();
  const { tournament, venues, addVenue, addVenues, updateVenue, deleteVenue, activeRound, saveTournament } = useTournament();
  const [newUrl, setNewUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPriority, setNewPriority] = useState(10);
  const [newCategory, setNewCategory] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [newAccessible, setNewAccessible] = useState(false);
  const [newOnline, setNewOnline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvPreview, setCsvPreview] = useState<Venue[]>([]);
  const [csvError, setCsvError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [venuePendingDelete, setVenuePendingDelete] = useState<Venue | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredVenues = venues.filter((v) =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const roundLabel = activeRound ? activeRound.abbreviation || activeRound.name : "";
  const columnCount = activeRound ? 9 : 8;

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const url = safeVenueUrl(newUrl);
    if (newUrl.trim() && !url) {
      setUrlError(t("setup.importsExtra.venues.urlError"));
      return;
    }
    setUrlError("");

    const venueFields = withVenueCategories({
      name: newName.trim(),
      priority: newPriority,
      capacity: newCapacity ? Number(newCapacity) : undefined,
      accessible: newAccessible,
      online: newOnline,
      url,
    }, parseVenueCategoryList(newCategory));
    if (editingVenue) {
      await updateVenue({ ...editingVenue, ...venueFields });
    } else {
      await addVenue({ ...venueFields, available: true });
    }

    setNewName("");
    setNewPriority(10);
    setNewCategory("");
    setNewCapacity("");
    setNewAccessible(false);
    setNewOnline(false);
    setEditingVenue(null);
    setShowAddModal(false);
  };

  const openEditVenue = (venue: Venue) => {
    setEditingVenue(venue);
    setNewName(venue.name);
    setNewPriority(venue.priority || 10);
    setNewCategory(venueCategoryNames(venue).join(", "));
    setNewCapacity(venue.capacity === undefined ? "" : String(venue.capacity));
    setNewAccessible(venue.accessible === true);
    setNewOnline(venue.online === true);
    setNewUrl(venue.url ?? "");
    setUrlError("");
    setShowAddModal(true);
  };

  const openAddVenue = () => {
    setEditingVenue(null);
    setNewName("");
    setNewPriority(10);
    setNewCategory("");
    setNewCapacity("");
    setNewAccessible(false);
    setNewOnline(false);
    setNewUrl("");
    setUrlError("");
    setShowAddModal(true);
  };

  const toggleAvailability = async (venue: Venue) => {
    await updateVenue({ ...venue, available: venue.available === false });
  };

  /** Availability in the selected round only (Tabbycat round availability for rooms). */
  const toggleRoundAvailability = async (venue: Venue) => {
    if (!activeRound) return;
    await updateVenue(setVenueRoundAvailability(venue, activeRound.id, !isVenueAvailableForRound(venue, activeRound.id)));
  };

  const confirmDelete = async () => {
    if (!venuePendingDelete) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await deleteVenue(venuePendingDelete.id);
      setVenuePendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("setup.importsExtra.venues.deleteError"));
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── CSV Import Handlers ───
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      parseCsvPreview(text);
    };
    reader.readAsText(file);
  };

  const parseCsvPreview = (text: string) => {
    setCsvError("");
    if (!text.trim()) {
      setCsvPreview([]);
      return;
    }
    try {
      const parsed = parseVenuesCsv(text, tournament?.id || "");
      if (parsed.length === 0) {
        setCsvError(t("setup.importsExtra.venues.csvNoVenues"));
      }
      setCsvPreview(parsed);
    } catch (err: unknown) {
      // Parser messages are shown as they are (English).
      setCsvError((err instanceof Error && err.message) || t("setup.importsExtra.venues.csvParseError"));
      setCsvPreview([]);
    }
  };

  const handleCsvTextChange = (text: string) => {
    setCsvText(text);
    parseCsvPreview(text);
  };

  const closeCsvModal = () => {
    setShowCsvModal(false);
    setCsvText("");
    setCsvPreview([]);
    setCsvError("");
  };

  const handleCsvImport = async () => {
    if (csvPreview.length === 0) return;
    setIsImporting(true);
    try {
      await addVenues(csvPreview.map(({ available: _available, ...venue }) => ({
        ...venue,
        available: true,
      })));
      setCsvText("");
      setCsvPreview([]);
      setShowCsvModal(false);
    } finally {
      setIsImporting(false);
    }
  };

  const csvColumns: Array<{ column: string; key: Parameters<typeof t>[0] }> = [
    { column: "name", key: "setup.importsExtra.venues.csvColName" },
    { column: "priority", key: "setup.importsExtra.venues.csvColPriority" },
    { column: "category", key: "setup.importsExtra.venues.csvColCategory" },
    { column: "capacity", key: "setup.importsExtra.venues.csvColCapacity" },
    { column: "accessible", key: "setup.importsExtra.venues.csvColAccessible" },
    { column: "online", key: "setup.importsExtra.venues.csvColOnline" },
    { column: "url", key: "setup.importsExtra.venues.csvColUrl" },
  ];

  const pillButtonClasses = cn("inline-flex rounded-sm", focusRing);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("setup.importsExtra.venues.title")}
        description={rich("setup.importsExtra.venues.description", {
          link: (label) => (
            <Link href={`/${tournament?.slug}/imports/venue-constraints`} className="text-accent-text underline">
              {label}
            </Link>
          ),
        })}
        actions={
          <>
            <Button onClick={() => setShowCsvModal(true)}>
              <Upload aria-hidden="true" />
              {t("setup.importsExtra.venues.importCsv")}
            </Button>
            <Button variant="primary" onClick={openAddVenue}>
              <Plus aria-hidden="true" />
              {t("setup.importsExtra.venues.addVenue")}
            </Button>
          </>
        }
      />

      {venues.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title={t("setup.importsExtra.venues.emptyTitle")}
          description={t("setup.importsExtra.venues.emptyDescription")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={openAddVenue}>
                <Plus aria-hidden="true" />
                {t("setup.importsExtra.venues.addVenue")}
              </Button>
              <Button onClick={() => setShowCsvModal(true)}>
                <Upload aria-hidden="true" />
                {t("setup.importsExtra.venues.importCsv")}
              </Button>
            </div>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 p-3">
            <Input
              type="search"
              aria-label={t("setup.importsExtra.venues.search")}
              placeholder={t("setup.importsExtra.venues.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leadingIcon={<Search />}
              wrapperClassName="w-full sm:w-64"
            />
            <span className="text-xs font-medium text-fg-muted">
              {t("setup.importsExtra.venues.activeOfTotal", {
                active: venues.filter((v) => v.available !== false).length,
                total: venues.length,
              })}
            </span>
          </div>

          <TableContainer className="rounded-none border-0">
            <Table>
              <THead>
                <TR>
                  <TH align="center" className="w-12">{t("setup.importsExtra.venues.number")}</TH>
                  <TH>{t("setup.importsExtra.venues.roomName")}</TH>
                  <TH>{t("setup.importsExtra.venues.category")}</TH>
                  <TH align="center" className="w-24">{t("setup.importsExtra.venues.capacity")}</TH>
                  <TH className="w-24">{t("setup.importsExtra.venues.capabilities")}</TH>
                  <TH align="center" className="w-24">{t("setup.importsExtra.venues.priority")}</TH>
                  <TH align="center" className="w-28">{t("setup.importsExtra.venues.availability")}</TH>
                  {activeRound && (
                    <TH align="center" className="w-28">{t("setup.importsExtra.venues.inRound", { round: roundLabel })}</TH>
                  )}
                  <TH align="right" className="w-20">{t("setup.common.actions")}</TH>
                </TR>
              </THead>
              <TBody>
                {filteredVenues.length === 0 && (
                  <TableEmpty colSpan={columnCount}>{t("setup.importsExtra.venues.noMatches")}</TableEmpty>
                )}
                {filteredVenues.map((venue, idx) => {
                  const link = safeVenueUrl(venue.url);
                  const available = venue.available !== false;
                  const inRound = activeRound ? isVenueAvailableForRound(venue, activeRound.id) : false;
                  const roundDefault = activeRound ? venue.roundAvailability?.[activeRound.id] === undefined : true;
                  return (
                    <TR key={venue.id}>
                      <TD align="center" className="font-mono text-xs text-fg-muted">{idx + 1}</TD>
                      <TD
                        className="text-xs font-semibold"
                        title={venueTooltip(venue, tournament?.preferences?.venueCategories, "admin")}
                      >
                        {venue.name}
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn("ms-1.5 inline-flex items-center rounded-sm text-accent-text hover:text-accent-hover", focusRing)}
                            aria-label={t("setup.importsExtra.venues.openLink", { name: venue.name })}
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </TD>
                      <TD>
                        <Input
                          aria-label={t("setup.importsExtra.venues.categoryOf", { name: venue.name })}
                          defaultValue={venueCategoryNames(venue).join(", ")}
                          placeholder={t("setup.importsExtra.venues.generalCategory")}
                          onBlur={(e) => {
                            const next = parseVenueCategoryList(e.currentTarget.value);
                            if (next.join("|") !== venueCategoryNames(venue).join("|")) {
                              void updateVenue(withVenueCategories(venue, next));
                            }
                          }}
                          className="h-7 min-w-24 text-xs"
                        />
                      </TD>
                      <TD align="center">
                        <Input
                          aria-label={t("setup.importsExtra.venues.capacityOf", { name: venue.name })}
                          type="number"
                          min="0"
                          defaultValue={venue.capacity ?? ""}
                          placeholder="—"
                          onBlur={(e) => {
                            const value = e.currentTarget.value.trim();
                            const capacity = value ? Number(value) : undefined;
                            if (capacity !== undefined && (!Number.isFinite(capacity) || capacity < 0)) {
                              e.currentTarget.reportValidity();
                              return;
                            }
                            if (capacity !== venue.capacity) void updateVenue({ ...venue, capacity });
                          }}
                          className="h-7 w-16 text-center text-xs"
                        />
                      </TD>
                      <TD>
                        <div className="flex flex-col items-start gap-1">
                          <Checkbox
                            label={t("setup.importsExtra.venues.accessible")}
                            checked={venue.accessible === true}
                            onChange={(e) => void updateVenue({ ...venue, accessible: e.target.checked })}
                          />
                          <Checkbox
                            label={t("setup.importsExtra.venues.online")}
                            checked={venue.online === true}
                            onChange={(e) => void updateVenue({ ...venue, online: e.target.checked })}
                          />
                        </div>
                      </TD>
                      <TD numeric align="center">{venue.priority || 10}</TD>
                      <TD align="center">
                        <button
                          type="button"
                          onClick={() => toggleAvailability(venue)}
                          title={t("setup.importsExtra.venues.toggleAvailability", { name: venue.name })}
                          className={pillButtonClasses}
                        >
                          <StatusPill tone={available ? "success" : "danger"}>
                            {available ? t("setup.importsExtra.venues.available") : t("setup.importsExtra.venues.unavailable")}
                          </StatusPill>
                        </button>
                      </TD>
                      {activeRound && (
                        <TD align="center">
                          <button
                            type="button"
                            onClick={() => toggleRoundAvailability(venue)}
                            aria-pressed={inRound}
                            aria-label={t("setup.importsExtra.venues.toggleRound", { name: venue.name, round: roundLabel })}
                            title={roundDefault ? t("setup.importsExtra.venues.roundDefault") : t("setup.importsExtra.venues.roundOverride")}
                            className={pillButtonClasses}
                          >
                            <StatusPill tone={inRound ? "success" : "danger"}>
                              {inRound ? t("setup.importsExtra.venues.inUse") : t("setup.importsExtra.venues.notInUse")}
                              {roundDefault ? "" : " *"}
                            </StatusPill>
                          </button>
                        </TD>
                      )}
                      <TD align="right" className="whitespace-nowrap">
                        <IconButton
                          size="sm"
                          label={t("setup.importsExtra.venues.editVenue", { name: venue.name })}
                          icon={<Pencil />}
                          onClick={() => openEditVenue(venue)}
                        />
                        <IconButton
                          size="sm"
                          label={t("setup.importsExtra.venues.deleteVenue", { name: venue.name })}
                          icon={<Trash2 />}
                          onClick={() => {
                            setDeleteError("");
                            setVenuePendingDelete(venue);
                          }}
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {tournament && (
        <VenueCategoriesEditor
          venues={venues}
          categories={tournament.preferences?.venueCategories}
          onSave={(venueCategories) =>
            saveTournament({ ...tournament, preferences: { ...tournament.preferences, venueCategories } })
          }
        />
      )}

      {/* Add / edit venue */}
      <Dialog
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={editingVenue ? t("setup.importsExtra.venues.editTitle") : t("setup.importsExtra.venues.addTitle")}
        icon={<MapPin className="text-fg-subtle" aria-hidden="true" />}
        footer={
          <>
            <Button onClick={() => setShowAddModal(false)}>{t("setup.common.cancel")}</Button>
            <Button type="submit" form={VENUE_FORM_ID} variant="primary">
              {editingVenue ? t("setup.common.saveChanges") : t("setup.importsExtra.venues.addRoom")}
            </Button>
          </>
        }
      >
        <form id={VENUE_FORM_ID} onSubmit={handleCreateVenue} className="space-y-3">
          <Input
            label={t("setup.importsExtra.venues.roomNameLabel")}
            type="text"
            required
            placeholder={t("setup.importsExtra.venues.roomNamePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            label={t("setup.importsExtra.venues.priorityLabel")}
            help={t("setup.importsExtra.venues.priorityHelp")}
            type="number"
            min="1"
            max="100"
            value={newPriority}
            onChange={(e) => setNewPriority(parseInt(e.target.value, 10))}
            className="font-mono"
          />
          <Input
            label={t("setup.importsExtra.venues.categoryLabel")}
            help={`${t("setup.importsExtra.venues.categoryHelp")} ${t("setup.importsExtra.venues.categoryMultipleHelp")}`}
            type="text"
            placeholder={t("setup.importsExtra.venues.generalCategory")}
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <Input
            label={t("setup.importsExtra.venues.capacityLabel")}
            type="number"
            min="0"
            placeholder={t("setup.importsExtra.venues.capacityPlaceholder")}
            value={newCapacity}
            onChange={(e) => setNewCapacity(e.target.value)}
          />
          <Input
            id="venue-url"
            label={t("setup.importsExtra.venues.urlLabel")}
            help={t("setup.importsExtra.venues.urlHelp")}
            error={urlError || undefined}
            type="url"
            placeholder="https://"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
          <div className="flex flex-wrap gap-4">
            <Checkbox
              label={t("setup.importsExtra.venues.accessible")}
              checked={newAccessible}
              onChange={(e) => setNewAccessible(e.target.checked)}
            />
            <Checkbox
              label={t("setup.importsExtra.venues.onlineCapable")}
              checked={newOnline}
              onChange={(e) => setNewOnline(e.target.checked)}
            />
          </div>
        </form>
      </Dialog>

      {/* CSV import */}
      <Dialog
        open={showCsvModal}
        onClose={closeCsvModal}
        size="lg"
        title={t("setup.importsExtra.venues.csvTitle")}
        icon={<Upload className="text-fg-subtle" aria-hidden="true" />}
        footer={
          <>
            <Button onClick={closeCsvModal}>{t("setup.common.cancel")}</Button>
            <Button
              variant="primary"
              onClick={handleCsvImport}
              disabled={csvPreview.length === 0}
              loading={isImporting}
              loadingText={t("setup.importsExtra.csv.importing")}
            >
              <Upload aria-hidden="true" />
              {plural("setup.importsExtra.venues.csvImport", csvPreview.length)}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="venues-csv-file">{t("setup.importsExtra.venues.csvUpload")}</Label>
            <input
              id="venues-csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv"
              onChange={handleFileUpload}
              className={cn(
                "block w-full cursor-pointer rounded-md border border-border-strong bg-surface text-xs text-fg-muted",
                "file:me-3 file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-fg hover:file:bg-border",
                focusRing
              )}
            />
          </div>

          <p className="text-center text-xs text-fg-muted">— {t("setup.importsExtra.venues.csvOr")} —</p>

          <Textarea
            label={t("setup.importsExtra.venues.csvContent")}
            rows={6}
            placeholder={CSV_EXAMPLE}
            value={csvText}
            onChange={(e) => handleCsvTextChange(e.target.value)}
            className="resize-y font-mono text-xs"
          />

          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-semibold text-fg">{t("setup.importsExtra.venues.csvColumnsTitle")}</p>
            <ul className="space-y-0.5 text-xs text-fg-muted">
              {csvColumns.map(({ column, key }) => (
                <li key={column}>
                  <code className="font-mono font-semibold text-fg">{column}</code> — {t(key)}
                </li>
              ))}
            </ul>
          </div>

          {csvError && (
            <Alert tone="danger" role="alert">
              {csvError}
            </Alert>
          )}

          {csvPreview.length > 0 && (
            <div className="space-y-2">
              <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                {plural("setup.importsExtra.venues.csvPreview", csvPreview.length)}
              </p>
              <TableContainer className="max-h-48">
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("setup.importsExtra.venues.number")}</TH>
                      <TH>{t("setup.common.name")}</TH>
                      <TH align="right">{t("setup.importsExtra.venues.priority")}</TH>
                      <TH>{t("setup.importsExtra.venues.category")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {csvPreview.map((v, idx) => (
                      <TR key={idx}>
                        <TD className="font-mono text-xs text-fg-muted">{idx + 1}</TD>
                        <TD className="font-semibold">{v.name}</TD>
                        <TD numeric>{v.priority}</TD>
                        <TD className="text-fg-muted">{venueCategoryNames(v).join(", ") || t("setup.importsExtra.venues.generalCategory")}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </div>
          )}
        </div>
      </Dialog>

      {venuePendingDelete && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.importsExtra.venues.deleteTitle", { name: venuePendingDelete.name })}
          description={t("setup.importsExtra.venues.deleteDescription")}
          confirmLabel={t("setup.common.delete")}
          isBusy={isDeleting}
          error={deleteError || undefined}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setVenuePendingDelete(null)}
        />
      )}
    </div>
  );
}
