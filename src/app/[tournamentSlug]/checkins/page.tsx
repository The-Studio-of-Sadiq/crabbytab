"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Users,
  Users2,
  MapPin,
  Search,
  Printer,
} from "lucide-react";
import { Code39Barcode } from "@/components/ui/Code39Barcode";
import { isAvailableForRound } from "@/lib/roundAvailability";

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
}

type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
};

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

  const [activeTab, setActiveTab] = useState<"teams" | "adjs" | "venues">("teams");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [scanStatus, setScanStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [showBarcodeSheet, setShowBarcodeSheet] = useState(false);
  const [cameraScanning, setCameraScanning] = useState(false);
  const scannerRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const checkedInTeams = teams.filter((t) => t.checkedIn !== false).length;
  const checkedInAdjs = adjudicators.filter((a) => a.checkedIn !== false).length;
  const checkInExpiry = tournament?.preferences?.checkInExpiresAfterHours;
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
        setScanStatus({ message: "Camera barcode scanning is not supported by this browser. Use a USB scanner instead.", error: true });
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
        if (!videoElement) throw new Error("The camera preview is unavailable.");
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
            setScanStatus({ message: "Could not read a barcode from the camera stream.", error: true });
          } finally {
            inFlight = false;
            if (!stopped) animationFrame = window.requestAnimationFrame(() => void scanFrame());
          }
        };
        animationFrame = window.requestAnimationFrame(() => void scanFrame());
      } catch (error) {
        setScanStatus({
          message: error instanceof Error ? `Camera could not be started: ${error.message}` : "Camera permission was denied.",
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

  const toggleTeamCheckin = async (team: (typeof teams)[number]) => {
    if (!activeRound) return;
    const available = isAvailableForRound(team, activeRound, checkInExpiry);
    const timestamp = new Date().toISOString();
    await updateTeam({
      ...team,
      roundAvailability: { ...team.roundAvailability, [activeRound.id]: !available },
      roundAvailabilityAt: { ...team.roundAvailabilityAt, [activeRound.id]: timestamp },
    });
  };

  const toggleAdjCheckin = async (adj: (typeof adjudicators)[number]) => {
    if (!activeRound) return;
    const available = isAvailableForRound(adj, activeRound, checkInExpiry);
    const timestamp = new Date().toISOString();
    await updateAdjudicator({
      ...adj,
      roundAvailability: { ...adj.roundAvailability, [activeRound.id]: !available },
      roundAvailabilityAt: { ...adj.roundAvailabilityAt, [activeRound.id]: timestamp },
    });
  };

  const checkInAll = async () => {
    if (activeTab === "teams") {
      for (const t of teams) {
        if (activeRound && !isAvailableForRound(t, activeRound, checkInExpiry)) {
          await updateTeam({
            ...t,
            roundAvailability: { ...t.roundAvailability, [activeRound.id]: true },
            roundAvailabilityAt: { ...t.roundAvailabilityAt, [activeRound.id]: new Date().toISOString() },
          });
        }
      }
    } else if (activeTab === "adjs") {
      for (const a of adjudicators) {
        if (activeRound && !isAvailableForRound(a, activeRound, checkInExpiry)) {
          await updateAdjudicator({
            ...a,
            roundAvailability: { ...a.roundAvailability, [activeRound.id]: true },
            roundAvailabilityAt: { ...a.roundAvailabilityAt, [activeRound.id]: new Date().toISOString() },
          });
        }
      }
    } else {
      for (const venue of venues) {
        if (venue.checkedIn === false) await updateVenue({ ...venue, checkedIn: true });
      }
    }
  };

  const handleScan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scannedId = scanValue.trim().toLowerCase();
    if (!scannedId) return;

    try {
      const team = teams.find((item) => item.id.toLowerCase() === scannedId);
      if (team) {
        if (!activeRound) throw new Error("Select a round before scanning a team.");
        await updateTeam({
          ...team,
          roundAvailability: { ...team.roundAvailability, [activeRound.id]: true },
          roundAvailabilityAt: { ...team.roundAvailabilityAt, [activeRound.id]: new Date().toISOString() },
        });
        setScanStatus({ message: `${team.name} checked in for ${activeRound.name}.`, error: false });
      } else {
        const adjudicator = adjudicators.find((item) => item.id.toLowerCase() === scannedId);
        if (adjudicator) {
          if (!activeRound) throw new Error("Select a round before scanning an adjudicator.");
          await updateAdjudicator({
            ...adjudicator,
            roundAvailability: { ...adjudicator.roundAvailability, [activeRound.id]: true },
            roundAvailabilityAt: { ...adjudicator.roundAvailabilityAt, [activeRound.id]: new Date().toISOString() },
          });
          setScanStatus({ message: `${adjudicator.name} checked in for ${activeRound.name}.`, error: false });
        } else {
          const venue = venues.find((item) => item.id.toLowerCase() === scannedId);
          if (!venue) throw new Error("No team, adjudicator, or venue matches that barcode.");
          await updateVenue({ ...venue, checkedIn: true });
          setScanStatus({ message: `${venue.name} checked in.`, error: false });
        }
      }
      setScanValue("");
      scannerRef.current?.focus();
    } catch (error) {
      setScanStatus({
        message: error instanceof Error ? error.message : "The barcode could not be processed.",
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

  return (
    <>
    <div className="space-y-6 screen-only">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Clock className="w-6 h-6 text-blue-600" />
            <span>Availability</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Set team and adjudicator availability for each round. Rounds without an override inherit global check-in.
          </p>
        </div>

        <button
          onClick={checkInAll}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs shadow-xs transition"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Mark All Present</span>
        </button>
        <button
          onClick={printBarcodeLabels}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Print Barcode Labels</span>
        </button>
        <Link
          href={`/${tournament?.slug}/checkins/public`}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
        >
          <span>Public Status</span>
        </Link>
      </div>

      <form onSubmit={handleScan} className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
        <label htmlFor="checkin-barcode" className="block text-xs font-bold text-blue-950">
          Scan participant or venue barcode
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            ref={scannerRef}
            id="checkin-barcode"
            autoComplete="off"
            value={scanValue}
            onChange={(event) => setScanValue(event.target.value)}
            placeholder="Click here, then scan with a USB barcode scanner"
            className="min-w-64 flex-1 rounded border border-blue-300 bg-white px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800"
          >
            Check In
          </button>
          <button
            type="button"
            onClick={() => setCameraScanning((active) => !active)}
            className="rounded border border-blue-400 bg-white px-4 py-2 text-xs font-bold text-blue-900 hover:bg-blue-100"
          >
            {cameraScanning ? "Stop camera" : "Use camera"}
          </button>
        </div>
        {cameraScanning && (
          <video
            ref={videoRef}
            aria-label="Camera barcode scanner preview"
            muted
            playsInline
            className="max-h-64 w-full rounded border border-blue-300 bg-black object-contain"
          />
        )}
        <p className="text-[11px] text-blue-800">
          Most USB scanners type the barcode and press Enter. This field also accepts a pasted participant or venue ID.
        </p>
        {scanStatus && (
          <p role="status" className={`text-xs font-semibold ${scanStatus.error ? "text-red-700" : "text-emerald-800"}`}>
            {scanStatus.message}
          </p>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="availability-round" className="text-xs font-semibold text-gray-700">Round</label>
        <select
          id="availability-round"
          value={activeRound?.id || ""}
          onChange={(event) => setActiveRound(rounds.find((round) => round.id === event.target.value) || null)}
          className="min-w-48 rounded border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {rounds.map((round) => <option key={round.id} value={round.id}>{round.abbreviation || round.name}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-2 border-b border-[#d0d7de] pb-3">
        <button
          onClick={() => setActiveTab("teams")}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
            activeTab === "teams"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>
            Teams ({roundTeamsPresent}/{teams.length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab("adjs")}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
            activeTab === "adjs"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Users2 className="w-3.5 h-3.5" />
          <span>
            Adjudicators ({roundAdjudicatorsPresent}/{adjudicators.length})
          </span>
        </button>
        <button
          onClick={() => setActiveTab("venues")}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
            activeTab === "venues"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>Venues ({venues.filter((venue) => venue.checkedIn !== false).length}/{venues.length})</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-gray-500" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={`Search ${activeTab === "teams" ? "teams" : activeTab === "adjs" ? "adjudicators" : "venues"} by name or ID`}
          className="w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {/* List */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th>{activeTab === "teams" ? "Team Name" : activeTab === "adjs" ? "Adjudicator Name" : "Venue"}</th>
                <th>{activeTab === "venues" ? "Category" : "Institution"}</th>
                <th className="w-32 text-center">Check-in Status</th>
              </tr>
            </thead>
            <tbody>
              {activeTab === "teams"
                ? filteredTeams.map((t, idx) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                      <td className="font-bold text-gray-900 text-xs">{t.name}</td>
                      <td className="text-xs text-gray-600">{t.institutionName || "—"}</td>
                      <td className="text-center">
                        <button
                          onClick={() => toggleTeamCheckin(t)}
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-bold transition ${
                            isAvailableForRound(t, activeRound, checkInExpiry)
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200"
                              : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-200"
                          }`}
                        >
                          {isAvailableForRound(t, activeRound, checkInExpiry) ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Present</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span>Absent</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))
                : activeTab === "adjs" ? filteredAdjudicators.map((a, idx) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                      <td className="font-bold text-gray-900 text-xs">{a.name}</td>
                      <td className="text-xs text-gray-600">{a.institutionName || "Independent"}</td>
                      <td className="text-center">
                        <button
                          onClick={() => toggleAdjCheckin(a)}
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-bold transition ${
                            isAvailableForRound(a, activeRound, checkInExpiry)
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200"
                              : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-200"
                          }`}
                        >
                          {isAvailableForRound(a, activeRound, checkInExpiry) ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Present</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span>Absent</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  )) : filteredVenues.map((venue, idx) => (
                    <tr key={venue.id} className="hover:bg-gray-50">
                      <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                      <td className="font-bold text-gray-900 text-xs">{venue.name}</td>
                      <td className="text-xs text-gray-600">{venue.category || "—"}</td>
                      <td className="text-center">
                        <button
                          onClick={() => updateVenue({ ...venue, checkedIn: venue.checkedIn === false })}
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-bold transition ${
                            venue.checkedIn !== false
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200"
                              : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-200"
                          }`}
                        >
                          {venue.checkedIn !== false ? "Present" : "Absent"}
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    {showBarcodeSheet && (
      <section className="print-only barcode-sheet">
        <h1>{tournament?.name} — Identification Barcodes</h1>
        <p>Scan the printed ID with a USB barcode scanner on the Check-ins page.</p>
        <div className="barcode-label-grid">
          {[
            ...teams.map((item) => ({ id: item.id, name: item.name, kind: "Team" })),
            ...adjudicators.map((item) => ({ id: item.id, name: item.name, kind: "Adjudicator" })),
            ...venues.map((item) => ({ id: item.id, name: item.name, kind: "Venue" })),
          ].map((item) => (
            <article key={`${item.kind}-${item.id}`} className="barcode-label">
              <strong>{item.kind}: {item.name}</strong>
              <Code39Barcode value={item.id} label={item.kind} />
            </article>
          ))}
        </div>
      </section>
    )}
    </>
  );
}
