"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  Printer,
  ScanBarcode,
  Search,
  Users,
  Users2,
  XCircle,
} from "lucide-react";
import { Code39Barcode } from "@/components/ui/Code39Barcode";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { CurrentRoundsBar } from "@/features/tournament/components/CurrentRoundsBar";
import { usePrintTranslator } from "@/features/tournament/components/PrintOptionsCard";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  availabilityFromPreviousRound,
  breakingAdjudicatorsAvailable,
  checkedInSpeakerCount,
  isSpeakerCheckedIn,
  previousRound,
  setParticipantAvailability,
  setSpeakerCheckIn,
  setVenueCheckIn,
} from "@/lib/checkins/history";
import type { CheckInEvent, CheckInSource } from "@/types";
import { isVenueCheckedIn } from "@/lib/venues/venues";
import type { Venue } from "@/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Badge";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}

type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
};

type CheckinTab = "teams" | "adjs" | "venues";
type AvailabilityState = "present" | "absent" | "expired";

const SOURCE_KEYS = {
  tab: "tabroom.ops.checkins.sourceTab",
  scan: "tabroom.ops.checkins.sourceScan",
  bulk: "tabroom.ops.checkins.sourceBulk",
  self: "tabroom.ops.checkins.sourceSelf",
} as const satisfies Record<CheckInSource, string>;

/** Per-row availability toggle: the pill shows the state (icon + text); pressed = present. */
function AvailabilityToggle({
  state,
  name,
  title,
  onToggle,
}: {
  state: AvailabilityState;
  name: string;
  title?: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const text =
    state === "present"
      ? t("tabroom.ops.checkins.present")
      : state === "expired"
        ? t("tabroom.ops.checkins.expired")
        : t("tabroom.ops.checkins.absent");
  return (
    <button
      type="button"
      aria-pressed={state === "present"}
      aria-label={t("tabroom.ops.checkins.presentToggle", { name, status: text })}
      title={title}
      onClick={onToggle}
      className={cn("rounded-sm transition-opacity hover:opacity-80", focusRing)}
    >
      <StatusPill
        tone={state === "present" ? "success" : state === "expired" ? "warning" : "danger"}
        icon={state === "present" ? <CheckCircle2 aria-hidden="true" /> : state === "expired" ? <Clock aria-hidden="true" /> : <XCircle aria-hidden="true" />}
      >
        {text}
      </StatusPill>
    </button>
  );
}

export default function CheckinsPage() {
  const {
    tournament,
    rounds,
    activeRound,
    setActiveRound,
    teams,
    adjudicators,
    venues,
    updateTeam,
    updateAdjudicator,
    updateVenue,
  } = useTournament();
  const { t, plural, formatDateTime, formatTime } = useI18n();
  // The barcode label sheet is printed for participants, in the tournament's language.
  const labelText = usePrintTranslator(tournament);
  const { user } = useAuth();
  const actor = user?.displayName || user?.email || undefined;
  const [bulkMessage, setBulkMessage] = useState("");

  const [activeTab, setActiveTab] = useState<CheckinTab>("teams");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanStatus, setScanStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [showBarcodeSheet, setShowBarcodeSheet] = useState(false);
  const [cameraScanning, setCameraScanning] = useState(false);
  const scannerRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // The camera effect only depends on `cameraScanning`; read the current translator through a ref.
  const tRef = useRef(t);
  tRef.current = t;

  const checkedInTeams = teams.filter((team) => team.checkedIn !== false).length;
  const checkedInAdjs = adjudicators.filter((a) => a.checkedIn !== false).length;
  const checkInExpiry = tournament?.preferences?.checkInExpiresAfterHours;
  const venueCheckInExpiry = tournament?.preferences?.venueCheckInExpiresAfterHours;
  const venuePresent = (venue: Venue) => isVenueCheckedIn(venue, venueCheckInExpiry);
  // Rooms: beta's check-in expiry (checkedInAt) plus the check-in history (lib/checkins/history.ts).
  const checkInVenue = (venue: Venue, present: boolean, source: CheckInSource = "tab") => {
    const at = new Date().toISOString();
    return updateVenue({
      ...setVenueCheckIn(venue, present, { source, by: actor, at }),
      checkedInAt: present ? at : venue.checkedInAt,
    });
  };
  const roundTeamsPresent = activeRound
    ? teams.filter((team) => isAvailableForRound(team, activeRound, checkInExpiry)).length
    : checkedInTeams;
  const roundAdjudicatorsPresent = activeRound
    ? adjudicators.filter((adj) => isAvailableForRound(adj, activeRound, checkInExpiry)).length
    : checkedInAdjs;
  const filteredTeams = teams.filter((team) =>
    `${team.name} ${team.institutionName ?? ""} ${team.id}`.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredAdjudicators = adjudicators.filter((adjudicator) =>
    `${adjudicator.name} ${adjudicator.institutionName ?? ""} ${adjudicator.id}`
      .toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredVenues = venues.filter((venue) =>
    `${venue.name} ${venue.category ?? ""} ${venue.id}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const handleAfterPrint = () => setShowBarcodeSheet(false);
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  useEffect(() => {
    if (!cameraScanning) return;
    let stopped = false;
    let animationFrame = 0;
    let stream: MediaStream | undefined;
    let videoElement: HTMLVideoElement | null = null;
    let inFlight = false;
    let lastScannedId = "";
    const startCamera = async () => {
      const Detector = (window as WindowWithBarcodeDetector).BarcodeDetector;
      if (!Detector) {
        setScanStatus({ message: tRef.current("tabroom.ops.checkins.cameraUnsupported"), error: true });
        setCameraScanning(false);
        return;
      }
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          cameraStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = cameraStream;
        videoElement = videoRef.current;
        if (!videoElement) throw new Error(tRef.current("tabroom.ops.checkins.cameraPreviewUnavailable"));
        videoElement.srcObject = cameraStream;
        await videoElement.play();
        const detector = new Detector({ formats: ["code_39"] });
        const scanFrame = async () => {
          if (stopped || !videoElement || inFlight) return;
          inFlight = true;
          try {
            const results = await detector.detect(videoElement);
            const rawValue = results[0]?.rawValue.trim();
            if (rawValue && rawValue !== lastScannedId) {
              lastScannedId = rawValue;
              setScanValue(rawValue);
              window.setTimeout(() => scannerRef.current?.form?.requestSubmit(), 0);
              window.setTimeout(() => { lastScannedId = ""; }, 1500);
            }
          } catch {
            setScanStatus({ message: tRef.current("tabroom.ops.checkins.cameraReadFailed"), error: true });
          } finally {
            inFlight = false;
            if (!stopped) animationFrame = window.requestAnimationFrame(() => void scanFrame());
          }
        };
        animationFrame = window.requestAnimationFrame(() => void scanFrame());
      } catch (error) {
        setScanStatus({
          message: error instanceof Error
            ? tRef.current("tabroom.ops.checkins.cameraStartFailed", { message: error.message })
            : tRef.current("tabroom.ops.checkins.cameraDenied"),
          error: true,
        });
        setCameraScanning(false);
      }
    };
    void startCamera();
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoElement) videoElement.srcObject = null;
    };
  }, [cameraScanning]);

  // Every change is recorded in the record's check-in history (lib/checkins/history.ts).
  const toggleTeamCheckin = async (team: (typeof teams)[number]) => {
    if (!activeRound) return;
    const available = isAvailableForRound(team, activeRound, checkInExpiry);
    await updateTeam(setParticipantAvailability(team, activeRound, !available, { source: "tab", by: actor }));
  };

  const toggleSpeakerCheckin = async (team: (typeof teams)[number], speakerId: string) => {
    if (!activeRound) return;
    const speaker = team.speakers.find((item) => item.id === speakerId);
    if (!speaker) return;
    await updateTeam(setSpeakerCheckIn(team, speakerId, activeRound, !isSpeakerCheckedIn(speaker, activeRound.id), { source: "tab", by: actor }));
  };

  const toggleAdjCheckin = async (adj: (typeof adjudicators)[number]) => {
    if (!activeRound) return;
    const available = isAvailableForRound(adj, activeRound, checkInExpiry);
    await updateAdjudicator(setParticipantAvailability(adj, activeRound, !available, { source: "tab", by: actor }));
  };

  const checkInAll = async () => {
    if (activeTab === "teams") {
      for (const team of teams) {
        if (activeRound && !isAvailableForRound(team, activeRound, checkInExpiry)) {
          await updateTeam(setParticipantAvailability(team, activeRound, true, { source: "bulk", by: actor }));
        }
      }
    } else if (activeTab === "adjs") {
      for (const a of adjudicators) {
        if (activeRound && !isAvailableForRound(a, activeRound, checkInExpiry)) {
          await updateAdjudicator(setParticipantAvailability(a, activeRound, true, { source: "bulk", by: actor }));
        }
      }
    } else {
      for (const venue of venues) {
        if (!venuePresent(venue)) await checkInVenue(venue, true, "bulk");
      }
    }
  };

  // Tabbycat's bulk check-ins: everyone available in the previous round, or the breaking adjudicators.
  const priorRound = activeRound ? previousRound(rounds, activeRound) : undefined;
  const checkInFromPreviousRound = async () => {
    if (!activeRound || !priorRound) return;
    const meta = { by: actor, expiresAfterHours: checkInExpiry };
    if (activeTab === "teams") {
      const updated = availabilityFromPreviousRound(teams, priorRound, activeRound, meta);
      for (const team of updated) await updateTeam(team);
      setBulkMessage(plural("tabroom.ops.checkins.bulkTeams", updated.length, { round: priorRound.name }));
    } else if (activeTab === "adjs") {
      const updated = availabilityFromPreviousRound(adjudicators, priorRound, activeRound, meta);
      for (const adjudicator of updated) await updateAdjudicator(adjudicator);
      setBulkMessage(plural("tabroom.ops.checkins.bulkAdjudicators", updated.length, { round: priorRound.name }));
    }
  };
  const checkInBreakingAdjudicators = async () => {
    if (!activeRound) return;
    const updated = breakingAdjudicatorsAvailable(adjudicators, activeRound, { by: actor, expiresAfterHours: checkInExpiry });
    for (const adjudicator of updated) await updateAdjudicator(adjudicator);
    setBulkMessage(plural("tabroom.ops.checkins.bulkBreaking", updated.length));
  };

  const recentEvents = React.useMemo(() => {
    const events: Array<CheckInEvent & { who: string }> = [];
    for (const team of teams) {
      for (const event of team.checkInHistory ?? []) events.push({ ...event, who: team.name });
      for (const speaker of team.speakers) {
        for (const event of speaker.checkInHistory ?? []) {
          events.push({ ...event, who: t("tabroom.ops.checkins.speakerOf", { speaker: speaker.name, team: team.name }) });
        }
      }
    }
    for (const adjudicator of adjudicators) for (const event of adjudicator.checkInHistory ?? []) events.push({ ...event, who: adjudicator.name });
    for (const venue of venues) for (const event of venue.checkInHistory ?? []) events.push({ ...event, who: venue.name });
    return events
      .filter((event) => !event.roundId || event.roundId === activeRound?.id)
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, 25);
  }, [teams, adjudicators, venues, activeRound?.id, t]);

  const handleScan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scannedId = scanValue.trim().toLowerCase();
    if (!scannedId) return;

    try {
      const team = teams.find((item) => item.id.toLowerCase() === scannedId);
      const speakerTeam = team ? undefined : teams.find((item) => item.speakers.some((speaker) => speaker.id.toLowerCase() === scannedId));
      if (team) {
        if (!activeRound) throw new Error(t("tabroom.ops.checkins.selectRoundTeam"));
        await updateTeam(setParticipantAvailability(team, activeRound, true, { source: "scan", by: actor }));
        setScanStatus({ message: t("tabroom.ops.checkins.checkedInForRound", { name: team.name, round: activeRound.name }), error: false });
      } else if (speakerTeam) {
        if (!activeRound) throw new Error(t("tabroom.ops.checkins.selectRoundSpeaker"));
        const speaker = speakerTeam.speakers.find((item) => item.id.toLowerCase() === scannedId)!;
        const updated = setSpeakerCheckIn(speakerTeam, speaker.id, activeRound, true, { source: "scan", by: actor });
        await updateTeam(updated);
        setScanStatus({
          message: t("tabroom.ops.checkins.speakerCheckedIn", {
            speaker: speaker.name,
            team: speakerTeam.name,
            present: checkedInSpeakerCount(updated, activeRound.id),
            total: updated.speakers.length,
          }),
          error: false,
        });
      } else {
        const adjudicator = adjudicators.find((item) => item.id.toLowerCase() === scannedId);
        if (adjudicator) {
          if (!activeRound) throw new Error(t("tabroom.ops.checkins.selectRoundAdjudicator"));
          await updateAdjudicator(setParticipantAvailability(adjudicator, activeRound, true, { source: "scan", by: actor }));
          setScanStatus({ message: t("tabroom.ops.checkins.checkedInForRound", { name: adjudicator.name, round: activeRound.name }), error: false });
        } else {
          const venue = venues.find((item) => item.id.toLowerCase() === scannedId);
          if (!venue) throw new Error(t("tabroom.ops.checkins.noMatch"));
          await checkInVenue(venue, true, "scan");
          setScanStatus({ message: t("tabroom.ops.checkins.venueCheckedIn", { name: venue.name }), error: false });
        }
      }
      setScanValue("");
      scannerRef.current?.focus();
    } catch (error) {
      setScanStatus({
        message: error instanceof Error ? error.message : t("tabroom.ops.checkins.scanFailed"),
        error: true,
      });
      setScanValue("");
      scannerRef.current?.focus();
    }
  };

  const printBarcodeLabels = () => {
    setShowBarcodeSheet(true);
    window.setTimeout(() => window.print(), 100);
  };

  const venueState = (venue: Venue): AvailabilityState =>
    venuePresent(venue) ? "present" : venue.checkedIn !== false ? "expired" : "absent";
  const venueTitle = (venue: Venue) =>
    venue.checkedIn !== false && !venuePresent(venue)
      ? t("tabroom.ops.checkins.expiredTitle")
      : venue.checkedInAt
        ? t("tabroom.ops.checkins.checkedInAt", { time: formatDateTime(venue.checkedInAt) })
        : undefined;

  const searchPlaceholder =
    activeTab === "teams"
      ? t("tabroom.ops.checkins.searchTeams")
      : activeTab === "adjs"
        ? t("tabroom.ops.checkins.searchAdjudicators")
        : t("tabroom.ops.checkins.searchVenues");
  const rowCount = activeTab === "teams" ? filteredTeams.length : activeTab === "adjs" ? filteredAdjudicators.length : filteredVenues.length;

  return (
    <>
    <div className="space-y-6 screen-only">
      <CurrentRoundsBar what="availability" />
      <PageHeader
        title={t("tabroom.ops.checkins.title")}
        description={t("tabroom.ops.checkins.description")}
        actions={
          <>
            <Button size="sm" onClick={() => void checkInAll()}>
              <CheckCircle2 aria-hidden="true" />
              {t("tabroom.ops.checkins.markAllPresent")}
            </Button>
            <Button size="sm" variant="secondary" onClick={printBarcodeLabels}>
              <Printer aria-hidden="true" />
              {t("tabroom.ops.checkins.printBarcodes")}
            </Button>
            {activeTab !== "venues" && priorRound && (
              <Button size="sm" variant="secondary" onClick={() => void checkInFromPreviousRound()}>
                <Copy aria-hidden="true" />
                {t("tabroom.ops.checkins.copyFromRound", { round: priorRound.abbreviation || priorRound.name })}
              </Button>
            )}
            {activeTab === "adjs" && (
              <Button size="sm" variant="secondary" onClick={() => void checkInBreakingAdjudicators()}>
                {t("tabroom.ops.checkins.markBreakingPresent")}
              </Button>
            )}
            <Link
              href={`/${tournament?.slug}/checkins/public`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <ExternalLink aria-hidden="true" />
              {t("tabroom.ops.checkins.publicStatus")}
            </Link>
          </>
        }
      />

      {bulkMessage && <p role="status" className="text-xs font-medium text-success">{bulkMessage}</p>}

      <Card>
        <CardHeader icon={<ScanBarcode aria-hidden="true" />} title={t("tabroom.ops.checkins.scanTitle")} />
        <CardBody>
          <form onSubmit={handleScan} className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <Input
                ref={scannerRef}
                label={t("tabroom.ops.checkins.scanLabel")}
                aria-describedby="checkin-barcode-help"
                autoComplete="off"
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                placeholder={t("tabroom.ops.checkins.scanPlaceholder")}
                wrapperClassName="min-w-0 flex-1 basis-64"
              />
              <div className="flex gap-2">
                <Button type="submit" size="md">{t("tabroom.ops.checkins.checkIn")}</Button>
                <Button
                  type="button"
                  size="md"
                  variant="secondary"
                  aria-pressed={cameraScanning}
                  onClick={() => setCameraScanning((active) => !active)}
                >
                  {cameraScanning ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
                  {cameraScanning ? t("tabroom.ops.checkins.stopCamera") : t("tabroom.ops.checkins.useCamera")}
                </Button>
              </div>
            </div>
            <p id="checkin-barcode-help" className="text-xs text-fg-muted">{t("tabroom.ops.checkins.scanHelp")}</p>
            {cameraScanning && (
              <video
                ref={videoRef}
                aria-label={t("tabroom.ops.checkins.cameraPreview")}
                muted
                playsInline
                className="max-h-64 w-full rounded-md border border-border bg-muted object-contain"
              />
            )}
            {scanStatus && (
              scanStatus.error ? (
                <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
                  <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {scanStatus.message}
                </p>
              ) : (
                <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {scanStatus.message}
                </p>
              )
            )}
          </form>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t("tabroom.ops.checkins.round")}
          value={activeRound?.id || ""}
          onChange={(event) => setActiveRound(rounds.find((round) => round.id === event.target.value) || null)}
          wrapperClassName="min-w-48"
        >
          {rounds.map((round) => <option key={round.id} value={round.id}>{round.abbreviation || round.name}</option>)}
        </Select>
        <Input
          aria-label={searchPlaceholder}
          type="search"
          leadingIcon={<Search />}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={searchPlaceholder}
          wrapperClassName="w-full max-w-md"
        />
      </div>

      <div className="space-y-3">
        <Tabs
          id="checkins"
          ariaLabel={t("tabroom.ops.checkins.listTabs")}
          value={activeTab}
          onValueChange={setActiveTab}
          items={[
            {
              value: "teams",
              icon: <Users aria-hidden="true" />,
              label: t("tabroom.ops.checkins.tabTeams", { present: roundTeamsPresent, total: teams.length }),
            },
            {
              value: "adjs",
              icon: <Users2 aria-hidden="true" />,
              label: t("tabroom.ops.checkins.tabAdjudicators", { present: roundAdjudicatorsPresent, total: adjudicators.length }),
            },
            {
              value: "venues",
              icon: <MapPin aria-hidden="true" />,
              label: t("tabroom.ops.checkins.tabVenues", { present: venues.filter(venuePresent).length, total: venues.length }),
            },
          ]}
        />
        <TabPanel id="checkins" value={activeTab}>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH align="center" className="w-12">#</TH>
                  <TH>
                    {activeTab === "teams"
                      ? t("tabroom.ops.checkins.colTeam")
                      : activeTab === "adjs"
                        ? t("tabroom.ops.checkins.colAdjudicator")
                        : t("tabroom.ops.checkins.colVenue")}
                  </TH>
                  <TH>{activeTab === "venues" ? t("tabroom.ops.checkins.colCategory") : t("tabroom.ops.checkins.colInstitution")}</TH>
                  <TH align="center" className="w-32">{t("tabroom.ops.checkins.colStatus")}</TH>
                </TR>
              </THead>
              <TBody>
                {rowCount === 0 && <TableEmpty colSpan={4}>{t("tabroom.ops.checkins.noMatches")}</TableEmpty>}
                {activeTab === "teams"
                  ? filteredTeams.map((team, idx) => (
                      <TR key={team.id}>
                        <TD align="center" className="font-mono text-xs text-fg-muted">{idx + 1}</TD>
                        <TD className="font-medium">
                          {team.name}
                          {activeRound && team.speakers.length > 0 && (
                            <span
                              role="group"
                              className="mt-1 flex flex-wrap items-center gap-1 font-normal"
                              aria-label={t("tabroom.ops.checkins.speakersOf", { team: team.name })}
                            >
                              {team.speakers.map((speaker) => {
                                const present = isSpeakerCheckedIn(speaker, activeRound.id);
                                return (
                                  <button
                                    key={speaker.id}
                                    type="button"
                                    aria-pressed={present}
                                    aria-label={t("tabroom.ops.checkins.speakerToggle", { name: speaker.name })}
                                    onClick={() => void toggleSpeakerCheckin(team, speaker.id)}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] transition-colors",
                                      present
                                        ? "border-success-border bg-success-subtle text-success"
                                        : "border-border bg-surface text-fg-muted hover:bg-muted",
                                      focusRing
                                    )}
                                  >
                                    {present && <Check className="h-3 w-3" aria-hidden="true" />}
                                    {speaker.name}
                                  </button>
                                );
                              })}
                              <span className="text-[11px] text-fg-muted">
                                {plural("tabroom.ops.checkins.speakerCount", team.speakers.length, {
                                  present: checkedInSpeakerCount(team, activeRound.id),
                                })}
                              </span>
                            </span>
                          )}
                        </TD>
                        <TD className="text-xs text-fg-muted">{team.institutionName || "—"}</TD>
                        <TD align="center">
                          <AvailabilityToggle
                            name={team.name}
                            state={isAvailableForRound(team, activeRound, checkInExpiry) ? "present" : "absent"}
                            onToggle={() => void toggleTeamCheckin(team)}
                          />
                        </TD>
                      </TR>
                    ))
                  : activeTab === "adjs"
                    ? filteredAdjudicators.map((adjudicator, idx) => (
                        <TR key={adjudicator.id}>
                          <TD align="center" className="font-mono text-xs text-fg-muted">{idx + 1}</TD>
                          <TD className="font-medium">{adjudicator.name}</TD>
                          <TD className="text-xs text-fg-muted">{adjudicator.institutionName || t("common.independent")}</TD>
                          <TD align="center">
                            <AvailabilityToggle
                              name={adjudicator.name}
                              state={isAvailableForRound(adjudicator, activeRound, checkInExpiry) ? "present" : "absent"}
                              onToggle={() => void toggleAdjCheckin(adjudicator)}
                            />
                          </TD>
                        </TR>
                      ))
                    : filteredVenues.map((venue, idx) => (
                        <TR key={venue.id}>
                          <TD align="center" className="font-mono text-xs text-fg-muted">{idx + 1}</TD>
                          <TD className="font-medium">{venue.name}</TD>
                          <TD className="text-xs text-fg-muted">{venue.category || "—"}</TD>
                          <TD align="center">
                            <AvailabilityToggle
                              name={venue.name}
                              state={venueState(venue)}
                              title={venueTitle(venue)}
                              onToggle={() => void checkInVenue(venue, !venuePresent(venue))}
                            />
                          </TD>
                        </TR>
                      ))}
              </TBody>
            </Table>
          </TableContainer>
        </TabPanel>
      </div>

      <details className="rounded-lg border border-border bg-surface p-3 text-xs">
        <summary className={cn("cursor-pointer rounded-sm font-medium text-fg", focusRing)}>
          {plural("tabroom.ops.checkins.history", recentEvents.length)}
        </summary>
        {recentEvents.length === 0 ? (
          <p className="mt-2 text-fg-muted">{t("tabroom.ops.checkins.historyEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {recentEvents.map((event, index) => (
              <li key={`${event.at}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
                <span className="font-mono text-fg-muted">{formatTime(event.at)}</span>
                <span className="font-medium text-fg">{event.who}</span>
                <StatusPill tone={event.available ? "success" : "danger"}>
                  {event.available ? t("tabroom.ops.checkins.historyPresent") : t("tabroom.ops.checkins.historyAbsent")}
                </StatusPill>
                <span className="text-fg-muted">
                  {event.by
                    ? t("tabroom.ops.checkins.historySourceBy", { source: t(SOURCE_KEYS[event.source]), by: event.by })
                    : t("tabroom.ops.checkins.historySource", { source: t(SOURCE_KEYS[event.source]) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
    {showBarcodeSheet && (
      <section className="print-only barcode-sheet" lang={labelText.locale}>
        <h1>{labelText.t("tabroom.ops.barcodes.title", { tournament: tournament?.name ?? "" })}</h1>
        <p>{labelText.t("tabroom.ops.barcodes.instructions")}</p>
        <div className="barcode-label-grid">
          {[
            ...teams.map((item) => ({ id: item.id, name: item.name, kind: labelText.t("tabroom.ops.barcodes.kindTeam") })),
            ...teams.flatMap((team) => team.speakers.map((speaker) => ({
              id: speaker.id,
              name: labelText.t("tabroom.ops.checkins.speakerOf", { speaker: speaker.name, team: team.name }),
              kind: labelText.t("tabroom.ops.barcodes.kindSpeaker"),
            }))),
            ...adjudicators.map((item) => ({ id: item.id, name: item.name, kind: labelText.t("tabroom.ops.barcodes.kindAdjudicator") })),
            ...venues.map((item) => ({ id: item.id, name: item.name, kind: labelText.t("tabroom.ops.barcodes.kindVenue") })),
          ].map((item) => (
            <article key={`${item.kind}-${item.id}`} className="barcode-label">
              <strong>{labelText.t("tabroom.ops.barcodes.label", { kind: item.kind, name: item.name })}</strong>
              <Code39Barcode value={item.id} label={item.kind} />
            </article>
          ))}
        </div>
      </section>
    )}
    </>
  );
}
