"use client";

import React, { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Info, Loader2 } from "lucide-react";
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
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

const COUNT_LABELS: Array<[keyof DebateXmlImportCounts, MessageKey]> = [
  ["institutions", "setup.entry.import.countInstitutions"],
  ["teams", "setup.entry.import.countTeams"],
  ["speakers", "setup.entry.import.countSpeakers"],
  ["adjudicators", "setup.entry.import.countAdjudicators"],
  ["conflicts", "setup.entry.import.countConflicts"],
  ["venues", "setup.entry.import.countVenues"],
  ["motions", "setup.entry.import.countMotions"],
  ["breakCategories", "setup.entry.import.countBreakCategories"],
  ["rounds", "setup.entry.import.countRounds"],
  ["debates", "setup.entry.import.countDebates"],
  ["byes", "setup.entry.import.countByes"],
  ["ballots", "setup.entry.import.countBallots"],
  ["votingBallots", "setup.entry.import.countVotingBallots"],
  ["feedback", "setup.entry.import.countFeedback"],
  ["feedbackQuestions", "setup.entry.import.countFeedbackQuestions"],
];

const MAX_MEGABYTES = DEBATE_XML_MAX_CHARACTERS / 1024 / 1024;

/** Imports a DebateXML archive (e.g. from Tabbycat) as a new tournament on this device. */
export function DebateXmlImportForm() {
  const router = useRouter();
  const { user, isGlobalAdmin, loading: authLoading } = useAuth();
  const { t, plural, rich, formatNumber } = useI18n();
  const fileId = useId();
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
      setError(t("setup.entry.import.tooLarge", { size: MAX_MEGABYTES }));
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
      setError(readError instanceof Error ? readError.message : t("setup.entry.import.readFailed"));
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
      setError(t("setup.entry.import.adminOnlyCreate"));
      return;
    }
    const slugError = validateSlug(slug);
    if (slugError) {
      setError(slugError);
      return;
    }
    if (!name.trim()) {
      setError(t("setup.entry.import.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      if (await isSlugUsedOnDevice(getLocalStore(), slug)) {
        throw new Error(t("setup.entry.slugExists", { slug }));
      }
      const result = runImport(xml, { slug, name: name.trim(), shortName: shortName.trim() });
      if (!result.data) throw new Error(t("setup.entry.import.hasErrors"));
      await saveImportedTournamentLocally(getLocalStore(), result.data);
      router.push(`/${slug}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("setup.entry.import.importFailed"));
      setBusy(false);
    }
  };

  if (authLoading) {
    return <p role="status" className="text-[13px] text-fg-muted">{t("setup.entry.checkingAccess")}</p>;
  }
  if (!isGlobalAdmin) {
    return (
      <Alert tone="warning" role="alert">
        {t("setup.entry.import.adminOnly")}
      </Alert>
    );
  }

  const issueLabel = (text: string) => <span className="font-semibold">{text}</span>;

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.entry.import.title")} description={t("setup.entry.import.intro")} />

      <Card>
        <CardHeader title={t("setup.entry.import.fileTitle")} icon={<FileUp aria-hidden="true" />} />
        <CardBody className="space-y-3">
          <Label htmlFor={fileId}>{t("setup.entry.import.fileLabel", { size: MAX_MEGABYTES })}</Label>
          <input
            id={fileId}
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={handleFile}
            disabled={busy}
            className={cn(
              "block w-full rounded-md text-[13px] text-fg-muted file:me-3 file:rounded-md file:border file:border-solid file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-fg hover:file:bg-muted disabled:opacity-50",
              focusRing
            )}
          />
          {busy && !preview && (
            <p role="status" className="flex items-center gap-2 text-[13px] text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("setup.entry.import.reading")}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Some messages (file problems from the parser, slug rules) come from lib code and are English for now. */}
      {error && <Alert tone="danger" role="alert">{error}</Alert>}

      {preview && (
        <div className="space-y-4">
          {errors.length > 0 ? (
            <Alert tone="danger" role="alert" title={plural("setup.entry.import.cannotImport", errors.length)}>
              <ul className="list-disc space-y-1 ps-5 text-xs">
                {errors.map((issue, index) => (
                  <li key={index}>
                    {rich("setup.entry.import.errorAt", { b: issueLabel }, { path: issue.path, message: issue.message })}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert tone="success" role="status">{t("setup.entry.import.valid")}</Alert>
          )}

          {warnings.length > 0 && (
            <Alert tone="warning" title={t("setup.entry.import.warningsTitle", { count: warnings.length })}>
              <ul className="list-disc space-y-1 ps-5 text-xs">
                {warnings.map((issue, index) => (
                  <li key={index}>
                    {rich("setup.entry.import.warningAt", { b: issueLabel }, { path: issue.path, message: issue.message })}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <Card>
            <CardHeader title={t("setup.entry.import.summaryTitle")} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                {COUNT_LABELS.map(([key, label]) => (
                  <div key={key} className="flex justify-between gap-2 border-b border-border py-1">
                    <dt className="text-fg-muted">{t(label)}</dt>
                    <dd className="font-mono font-semibold text-fg">{formatNumber(preview.counts[key])}</dd>
                  </div>
                ))}
              </dl>
              {preview.notes.length > 0 && (
                <ul className="mt-4 space-y-1 text-xs text-fg-muted">
                  {preview.notes.map((note) => (
                    <li key={note} className="flex items-start gap-2">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" /> {note}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {errors.length === 0 && (
            <Card>
              <CardHeader title={t("setup.entry.import.newTournamentTitle")} />
              <CardBody>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label={t("setup.common.name")}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      maxLength={120}
                    />
                    <Input
                      label={t("setup.entry.import.shortName")}
                      value={shortName}
                      onChange={(event) => setShortName(event.target.value)}
                      maxLength={15}
                    />
                    <Input
                      wrapperClassName="sm:col-span-2"
                      label={t("setup.entry.slugLabel")}
                      help={t("setup.entry.import.slugHelp", { slug: slug || "…" })}
                      value={slug}
                      onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40))}
                      className="font-mono"
                      required
                    />
                  </div>
                  <Button type="submit" variant="primary" loading={busy}>
                    {t("setup.entry.import.submit")}
                  </Button>
                </form>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
