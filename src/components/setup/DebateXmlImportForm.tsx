"use client";

import React, { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { slugify, validateSlug } from "@/lib/setup/presets";
import {
  DEBATE_XML_MAX_CHARACTERS,
  importDebateXmlArchive,
  parseXmlWithDomParser,
  type DebateXmlImportCounts,
  type DebateXmlImportResult,
} from "@/features/tournament/application/debateXmlImport";
import { isSlugUsedOnDevice, saveImportedTournamentLocally } from "@/features/tournament/application/importedTournamentStorage";
import { getLocalStore } from "@/lib/offline/localStore";

const COUNT_LABELS: Array<[keyof DebateXmlImportCounts, string]> = [
  ["institutions", "Institutions"],
  ["teams", "Teams"],
  ["speakers", "Speakers"],
  ["adjudicators", "Adjudicators"],
  ["conflicts", "Adjudicator conflicts"],
  ["venues", "Venues"],
  ["motions", "Motions"],
  ["breakCategories", "Break categories"],
  ["rounds", "Rounds"],
  ["debates", "Debates"],
  ["byes", "Byes"],
  ["ballots", "Ballots"],
  ["votingBallots", "of which voting ballots"],
  ["feedback", "Feedback submissions"],
  ["feedbackQuestions", "Feedback questions"],
];

const inputClass =
  "w-full rounded border border-[#d0d7de] px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/** Imports a DebateXML archive (e.g. from Tabbycat) as a new tournament on this device. */
export function DebateXmlImportForm() {
  const router = useRouter();
  const { user, isGlobalAdmin, loading: authLoading } = useAuth();
  const ids = { file: useId(), name: useId(), shortName: useId(), slug: useId() };
  const [xml, setXml] = useState("");
  const [preview, setPreview] = useState<DebateXmlImportResult | null>(null);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ownerId = user?.uid || "local";
  const runImport = (text: string, identity: { slug: string; name?: string; shortName?: string }) =>
    importDebateXmlArchive(text, {
      parseXml: parseXmlWithDomParser,
      identity: { id: `tourn-${identity.slug}`, ownerId, ...identity },
    });

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setPreview(null);
    setError("");
    setXml("");
    if (!file) return;
    if (file.size > DEBATE_XML_MAX_CHARACTERS) {
      setError(`The file is larger than ${DEBATE_XML_MAX_CHARACTERS / 1024 / 1024} MB.`);
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const result = runImport(text, { slug: "preview" });
      setXml(text);
      setPreview(result);
      const suggested = result.suggestedName || file.name.replace(/\.xml$/i, "");
      setName(suggested);
      setShortName(result.suggestedShortName || suggested.slice(0, 15));
      setSlug(slugify(suggested));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };

  const errors = preview?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === "warning") ?? [];

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!isGlobalAdmin) {
      setError("Only a global administrator can create a tournament.");
      return;
    }
    const slugError = validateSlug(slug);
    if (slugError) {
      setError(slugError);
      return;
    }
    if (!name.trim()) {
      setError("Enter a name for the tournament.");
      return;
    }
    setBusy(true);
    try {
      if (await isSlugUsedOnDevice(getLocalStore(), slug)) {
        throw new Error(`"${slug}" already exists on this device. Choose a different URL.`);
      }
      const result = runImport(xml, { slug, name: name.trim(), shortName: shortName.trim() });
      if (!result.data) throw new Error("The file has errors and cannot be imported.");
      await saveImportedTournamentLocally(getLocalStore(), result.data);
      router.push(`/${slug}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The import failed. Nothing was saved.");
      setBusy(false);
    }
  };

  if (authLoading) {
    return <p role="status" className="text-sm text-gray-600">Checking administrator access…</p>;
  }
  if (!isGlobalAdmin) {
    return (
      <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Only a global administrator can create a tournament, including by importing one.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Import a DebateXML archive</h1>
        <p className="mt-1 text-sm text-gray-600">
          Create a new tournament from a DebateXML file exported by Tabbycat or CrabbyTab. The file is checked
          first; nothing is saved until you confirm, and existing tournaments are never changed.
        </p>
      </div>

      <div className="rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
        <label htmlFor={ids.file} className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
          <FileUp className="h-4 w-4" /> DebateXML file (.xml, up to {DEBATE_XML_MAX_CHARACTERS / 1024 / 1024} MB)
        </label>
        <input
          id={ids.file}
          type="file"
          accept=".xml,application/xml,text/xml"
          onChange={handleFile}
          disabled={busy}
          className="block w-full text-sm file:mr-3 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold"
        />
        {busy && !preview && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the file…
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {preview && (
        <div className="space-y-4">
          {errors.length > 0 ? (
            <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" /> This file cannot be imported ({errors.length} error{errors.length === 1 ? "" : "s"})
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {errors.map((issue, index) => (
                  <li key={index}><span className="font-semibold">Error at {issue.path}:</span> {issue.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p role="status" className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> The file is valid and ready to import.
            </p>
          )}

          {warnings.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-bold">Warnings ({warnings.length})</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {warnings.map((issue, index) => (
                  <li key={index}><span className="font-semibold">Warning at {issue.path}:</span> {issue.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
            <h2 className="text-sm font-bold text-gray-900">What will be imported</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {COUNT_LABELS.map(([key, label]) => (
                <div key={key} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                  <dt className="text-gray-600">{label}</dt>
                  <dd className="font-mono font-semibold text-gray-900">{preview.counts[key]}</dd>
                </div>
              ))}
            </dl>
            {preview.notes.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-gray-700">
                {preview.notes.map((note) => (
                  <li key={note} className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" /> {note}</li>
                ))}
              </ul>
            )}
          </div>

          {errors.length === 0 && (
            <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
              <h2 className="text-sm font-bold text-gray-900">New tournament</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={ids.name} className="mb-1 block text-xs font-semibold text-gray-700">Name</label>
                  <input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required maxLength={120} />
                </div>
                <div>
                  <label htmlFor={ids.shortName} className="mb-1 block text-xs font-semibold text-gray-700">Short name</label>
                  <input id={ids.shortName} value={shortName} onChange={(event) => setShortName(event.target.value)} className={inputClass} maxLength={15} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={ids.slug} className="mb-1 block text-xs font-semibold text-gray-700">URL slug</label>
                  <input
                    id={ids.slug}
                    value={slug}
                    onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40))}
                    className={`${inputClass} font-mono`}
                    required
                    aria-describedby={`${ids.slug}-hint`}
                  />
                  <p id={`${ids.slug}-hint`} className="mt-1 text-xs text-gray-500">The tournament will open at /{slug || "…"}.</p>
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Create tournament from this file
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
