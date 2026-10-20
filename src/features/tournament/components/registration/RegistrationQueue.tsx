"use client";

import React, { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Hourglass, Pencil, RotateCcw, XCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import type { Adjudicator, FeedbackQuestion, Team } from "@/types";
import type { RegistrationSettings, RegistrationSubmission } from "@/lib/registration/types";
import { findRegistrationDuplicates, type DuplicateFlag } from "@/lib/registration/review";
import { likelyCreatedEntities } from "@/features/tournament/application/registrationApproval";
import { Badge, StatusPill, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Input, Textarea } from "@/components/ui/Field";
import { TabPanel, Tabs } from "@/components/ui/Tabs";

type Filter = "open" | "approved" | "rejected" | "all";

type Translate = ReturnType<typeof useI18n>["t"];

const STATUS: Record<RegistrationSubmission["status"], { label: MessageKey; tone: Tone; icon: React.ReactNode }> = {
  pending: { label: "setup.registration.statusPending", tone: "info", icon: <Clock aria-hidden="true" /> },
  approving: { label: "setup.registration.statusApproving", tone: "warning", icon: <Hourglass aria-hidden="true" /> },
  approved: { label: "setup.registration.statusApproved", tone: "success", icon: <CheckCircle2 aria-hidden="true" /> },
  rejected: { label: "setup.registration.statusRejected", tone: "neutral", icon: <XCircle aria-hidden="true" /> },
};

/** One whole sentence per (matched record kind, reason) pair, so translations never splice fragments. */
const DUPLICATE_MESSAGE: Record<DuplicateFlag["against"], Record<DuplicateFlag["reason"], MessageKey>> = {
  submission: {
    same_name: "setup.registration.dupSubmissionSameName",
    same_email: "setup.registration.dupSubmissionSameEmail",
    same_speaker: "setup.registration.dupSubmissionSameSpeaker",
  },
  team: {
    same_name: "setup.registration.dupTeamSameName",
    same_email: "setup.registration.dupTeamSameEmail",
    same_speaker: "setup.registration.dupTeamSameSpeaker",
  },
  adjudicator: {
    same_name: "setup.registration.dupAdjudicatorSameName",
    same_email: "setup.registration.dupAdjudicatorSameEmail",
    same_speaker: "setup.registration.dupAdjudicatorSameSpeaker",
  },
};

function formatAnswer(value: unknown, t: Translate): string {
  if (value === true) return t("setup.common.yes");
  if (value === false) return t("setup.common.no");
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}

function entryName(submission: RegistrationSubmission, t: Translate): string {
  const unnamed = t("setup.registration.unnamed");
  if (submission.kind === "institution") return submission.institution?.name ?? unnamed;
  return (submission.kind === "team" ? submission.team?.name : submission.adjudicator?.name) ?? unnamed;
}

const KIND_LABEL: Record<RegistrationSubmission["kind"], { label: MessageKey; tone: Tone }> = {
  team: { label: "setup.registration.kindTeam", tone: "accent" },
  adjudicator: { label: "setup.registration.kindAdjudicator", tone: "neutral" },
  institution: { label: "setup.registration.kindInstitution", tone: "info" },
};

/** Institution registrations: the places to allocate, prefilled with what was asked for. */
function AllocateForm({
  submission,
  busy,
  onAllocate,
}: {
  submission: RegistrationSubmission;
  busy: boolean;
  onAllocate: (teams: number, adjudicators: number) => void;
}) {
  const { t } = useI18n();
  const [teams, setTeams] = useState(String(submission.institutionRequest?.teamsRequested ?? 0));
  const [adjudicators, setAdjudicators] = useState(String(submission.institutionRequest?.adjudicatorsRequested ?? 0));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input label={t("setup.registration.teamPlaces")} type="number" min={0} max={1000} value={teams} onChange={(event) => setTeams(event.target.value)} wrapperClassName="w-28" />
      <Input
        label={t("setup.registration.adjudicatorPlaces")}
        type="number"
        min={0}
        max={1000}
        value={adjudicators}
        onChange={(event) => setAdjudicators(event.target.value)}
        wrapperClassName="w-32"
      />
      <Button size="sm" variant="primary" loading={busy} onClick={() => onAllocate(Number(teams) || 0, Number(adjudicators) || 0)}>
        <CheckCircle2 aria-hidden="true" />
        {t("setup.registration.allocateAndSend")}
      </Button>
    </div>
  );
}

export interface QueueActions {
  approve(submission: RegistrationSubmission): Promise<void>;
  /** Institution registrations: give places; the coach becomes the institution's representative. */
  allocate(submission: RegistrationSubmission, teams: number, adjudicators: number): Promise<void>;
  review(action: "reject" | "reopen" | "release" | "edit", submission: RegistrationSubmission, extra?: Record<string, unknown>): Promise<void>;
  markApproved(submission: RegistrationSubmission, entity: { id: string; name: string }): Promise<void>;
}

function EditDialog({
  submission,
  onClose,
  onSave,
}: {
  submission: RegistrationSubmission;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [institution, setInstitution] = useState(submission.institution?.name ?? "");
  const [contactName, setContactName] = useState(submission.contactName);
  const [contactEmail, setContactEmail] = useState(submission.contactEmail);
  const [teamName, setTeamName] = useState(submission.team?.name ?? "");
  const [speakers, setSpeakers] = useState(
    (submission.team?.speakers ?? []).map((speaker) => ({ ...speaker, email: speaker.email ?? "", categories: speaker.categories.join(", ") }))
  );
  const [adjudicatorName, setAdjudicatorName] = useState(submission.adjudicator?.name ?? "");
  const [adjudicatorEmail, setAdjudicatorEmail] = useState(submission.adjudicator?.email ?? "");
  const [institutionConflicts, setInstitutionConflicts] = useState((submission.adjudicator?.institutionConflicts ?? []).join("\n"));
  const [teamConflicts, setTeamConflicts] = useState((submission.adjudicator?.teamConflicts ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    const lines = (value: string) => value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    try {
      await onSave({
        institution,
        contactName,
        contactEmail,
        answers: submission.answers,
        ...(submission.kind === "team"
          ? {
              team: {
                name: teamName,
                // Optional team fields are not edited here; keep what the registrant chose.
                useInstitutionPrefix: submission.team?.useInstitutionPrefix,
                breakCategories: submission.team?.breakCategories,
                seed: submission.team?.seed,
                emoji: submission.team?.emoji,
                speakers: speakers.map((speaker) => ({
                  name: speaker.name,
                  email: speaker.email.trim() || undefined,
                  categories: speaker.categories.split(",").map((item) => item.trim()).filter(Boolean),
                })),
              },
            }
          : {
              adjudicator: {
                name: adjudicatorName,
                email: adjudicatorEmail,
                institutionConflicts: lines(institutionConflicts),
                teamConflicts: lines(teamConflicts),
              },
            }),
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("setup.registration.saveChangesFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!saving}
      size="lg"
      title={t("setup.registration.editTitle", { name: entryName(submission, t) })}
      description={t("setup.registration.editDescription")}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>{t("setup.common.cancel")}</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>{t("setup.common.saveChanges")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={t("setup.registration.institution")} value={institution} onChange={(event) => setInstitution(event.target.value)} />
          <Input label={t("setup.registration.contactName")} value={contactName} onChange={(event) => setContactName(event.target.value)} />
          <Input label={t("setup.registration.contactEmail")} type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
        </div>
        {submission.kind === "team" ? (
          <>
            <Input label={t("setup.registration.teamName")} value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            {speakers.map((speaker, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <Input
                  label={t("setup.registration.speakerNumber", { number: index + 1 })}
                  value={speaker.name}
                  onChange={(event) => setSpeakers((current) => current.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))}
                />
                <Input
                  label={t("setup.common.email")}
                  type="email"
                  value={speaker.email}
                  onChange={(event) => setSpeakers((current) => current.map((item, position) => (position === index ? { ...item, email: event.target.value } : item)))}
                />
                <Input
                  label={t("setup.registration.categories")}
                  value={speaker.categories}
                  onChange={(event) => setSpeakers((current) => current.map((item, position) => (position === index ? { ...item, categories: event.target.value } : item)))}
                />
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={t("setup.registration.adjudicatorName")} value={adjudicatorName} onChange={(event) => setAdjudicatorName(event.target.value)} />
              <Input label={t("setup.registration.adjudicatorEmail")} type="email" value={adjudicatorEmail} onChange={(event) => setAdjudicatorEmail(event.target.value)} />
            </div>
            <Textarea label={t("setup.registration.institutionConflictsLines")} rows={3} value={institutionConflicts} onChange={(event) => setInstitutionConflicts(event.target.value)} />
            <Textarea label={t("setup.registration.teamConflictsLines")} rows={3} value={teamConflicts} onChange={(event) => setTeamConflicts(event.target.value)} />
          </>
        )}
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
      </div>
    </Dialog>
  );
}

/** Replaces the old window.prompt: cancelling does nothing; confirming rejects with the (optional) reason. */
function RejectDialog({
  submission,
  onCancel,
  onConfirm,
}: {
  submission: RegistrationSubmission;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      role="alertdialog"
      onClose={onCancel}
      initialFocusRef={cancelRef}
      icon={<AlertTriangle className="text-danger" aria-hidden="true" />}
      title={t("setup.registration.rejectTitle", { name: entryName(submission, t) })}
      description={t("setup.registration.rejectDescription")}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel}>{t("setup.common.cancel")}</Button>
          <Button variant="danger" onClick={() => onConfirm(reason)}>
            <XCircle aria-hidden="true" />
            {t("setup.registration.rejectConfirm")}
          </Button>
        </>
      }
    >
      <Textarea
        label={t("setup.registration.rejectReason")}
        help={t("setup.registration.rejectReasonHelp")}
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Dialog>
  );
}

const SEED_TITLE_KEYS: MessageKey[] = ["common.seedTitle0", "common.seedTitle1", "common.seedTitle2", "common.seedTitle3"];

/** The optional team fields a registrant filled (docs/registration.md, "Team fields"). */
function TeamFieldsSummary({
  team,
  settings,
}: {
  team: NonNullable<RegistrationSubmission["team"]>;
  settings: Pick<RegistrationSettings, "teamBreakCategories" | "teamSeedMode">;
}) {
  const { t, formatList } = useI18n();
  const parts: string[] = [];
  if (team.useInstitutionPrefix) parts.push(t("setup.registration.summaryPrefix"));
  if (team.breakCategories?.length) {
    const names = team.breakCategories.map(
      (id) => settings.teamBreakCategories?.find((category) => category.id === id)?.name ?? id
    );
    parts.push(t("setup.registration.summaryBreakCategories", { list: formatList(names) }));
  }
  if (team.seed !== undefined) {
    const titleKey = settings.teamSeedMode === "title" ? SEED_TITLE_KEYS[team.seed] : undefined;
    parts.push(t("setup.registration.summarySeed", { seed: titleKey ? t(titleKey) : String(team.seed) }));
  }
  if (team.emoji) parts.push(t("setup.registration.summaryEmoji", { emoji: team.emoji }));
  if (parts.length === 0) return null;
  return <p className="text-xs text-fg-muted">{parts.join(" · ")}</p>;
}

function SubmissionCard({
  submission,
  questions,
  duplicates,
  likelyEntities,
  currentUid,
  approveBlocked,
  actions,
  settings,
}: {
  submission: RegistrationSubmission;
  settings: Pick<RegistrationSettings, "teamBreakCategories" | "teamSeedMode">;
  questions: FeedbackQuestion[];
  duplicates: DuplicateFlag[];
  likelyEntities: Array<{ id: string; name: string }>;
  currentUid: string;
  approveBlocked: string | null;
  actions: QueueActions;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const { t, formatDateTime, formatList } = useI18n();
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("setup.registration.updateFailed"));
    } finally {
      setBusy(null);
    }
  };
  const status = STATUS[submission.status];
  const answered = questions.filter((question) => formatAnswer(submission.answers[question.id], t) !== "");
  const name = entryName(submission, t);
  const institutionDetails = submission.institutionRequest
    ? [
        submission.institutionRequest.code ? t("setup.registration.institutionCode", { code: submission.institutionRequest.code }) : "",
        submission.institutionRequest.region ? t("setup.registration.institutionRegionValue", { region: submission.institutionRequest.region }) : "",
      ].filter(Boolean)
    : [];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
              {name}
              <Badge tone={KIND_LABEL[submission.kind].tone}>{t(KIND_LABEL[submission.kind].label)}</Badge>
              <StatusPill tone={status.tone} icon={status.icon}>{t(status.label)}</StatusPill>
              {submission.overAllocated && submission.status !== "rejected" && (
                <StatusPill tone="warning">{t("setup.registration.overAllocated")}</StatusPill>
              )}
              {submission.autoApproved && <Badge tone="success">{t("setup.registration.autoApproved")}</Badge>}
              {duplicates.length > 0 && submission.status !== "approved" && <StatusPill tone="warning">{t("setup.registration.possibleDuplicate")}</StatusPill>}
            </h3>
            <p className="text-xs text-fg-muted">
              {t(submission.representativeId ? "setup.registration.submissionMetaViaLink" : "setup.registration.submissionMeta", {
                institution: submission.institution?.name ?? t("setup.registration.noInstitution"),
                contact: submission.contactName,
                email: submission.contactEmail,
                date: formatDateTime(submission.submittedAt, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {submission.status === "pending" && submission.kind !== "institution" && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === "approve"}
                  disabled={busy !== null || Boolean(approveBlocked)}
                  title={approveBlocked ?? undefined}
                  onClick={() => void run("approve", () => actions.approve(submission))}
                >
                  <CheckCircle2 aria-hidden="true" />
                  {t("setup.registration.approve")}
                </Button>
                <Button size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" />
                  {t("setup.common.edit")}
                </Button>
              </>
            )}
            {(submission.status === "pending" || submission.status === "approving") && (
              <Button
                size="sm"
                variant="danger"
                loading={busy === "reject"}
                disabled={busy !== null}
                onClick={() => setRejecting(true)}
              >
                <XCircle aria-hidden="true" />
                {t("setup.registration.reject")}
              </Button>
            )}
            {submission.status === "rejected" && (
              <Button size="sm" loading={busy === "reopen"} disabled={busy !== null} onClick={() => void run("reopen", () => actions.review("reopen", submission))}>
                <RotateCcw aria-hidden="true" />
                {t("setup.registration.reopen")}
              </Button>
            )}
          </div>
        </div>

        {submission.kind === "institution" && submission.institutionRequest && (
          <div className="space-y-2 text-xs text-fg">
            <p>
              {t("setup.registration.institutionRequest", {
                teams: submission.institutionRequest.teamsRequested,
                adjudicators: submission.institutionRequest.adjudicatorsRequested,
              })}
              {institutionDetails.length > 0 ? ` ${institutionDetails.join(" · ")}` : ""}
            </p>
            {submission.status === "pending" && (
              <AllocateForm
                submission={submission}
                busy={busy === "allocate"}
                onAllocate={(teams, adjudicators) => void run("allocate", () => actions.allocate(submission, teams, adjudicators))}
              />
            )}
            {submission.status === "approved" && (
              <p className="text-success">
                {t("setup.registration.institutionAllocated", {
                  teams: submission.teamsAllocated ?? 0,
                  adjudicators: submission.adjudicatorsAllocated ?? 0,
                })}
              </p>
            )}
          </div>
        )}
        {submission.kind === "team" && submission.team && (
          <TeamFieldsSummary team={submission.team} settings={settings} />
        )}
        {submission.kind === "team" && submission.team && (
          <ul className="grid gap-1 text-xs text-fg sm:grid-cols-2">
            {submission.team.speakers.map((speaker, index) => (
              <li key={index}>
                <span className="font-medium">{speaker.name}</span>
                {speaker.email ? <span className="text-fg-muted"> · {speaker.email}</span> : null}
                {speaker.phone ? <span className="text-fg-muted"> · {speaker.phone}</span> : null}
                {speaker.gender ? <span className="text-fg-muted"> · {speaker.gender}</span> : null}
                {speaker.categories.length > 0 ? <span className="text-fg-muted"> · {speaker.categories.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {submission.kind === "adjudicator" && submission.adjudicator && (
          <div className="space-y-0.5 text-xs text-fg">
            <p>
              {submission.adjudicator.email}
              {submission.adjudicator.phone ? ` · ${submission.adjudicator.phone}` : ""}
              {submission.adjudicator.gender ? ` · ${submission.adjudicator.gender}` : ""}
            </p>
            {submission.adjudicator.institutionConflicts.length > 0 && (
              <p><span className="text-fg-muted">{t("setup.registration.institutionConflicts")}</span> {formatList(submission.adjudicator.institutionConflicts)}</p>
            )}
            {submission.adjudicator.teamConflicts.length > 0 && (
              <p><span className="text-fg-muted">{t("setup.registration.teamConflicts")}</span> {formatList(submission.adjudicator.teamConflicts)}</p>
            )}
          </div>
        )}
        {answered.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
            {answered.map((question) => (
              <React.Fragment key={question.id}>
                <dt className="text-fg-muted">{question.label}</dt>
                <dd className="text-fg">{formatAnswer(submission.answers[question.id], t)}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {duplicates.length > 0 && submission.status !== "approved" && (
          <Alert tone="warning" title={t("setup.registration.possibleDuplicate")}>
            <ul>
              {duplicates.map((flag) => (
                <li key={`${flag.against}-${flag.id}-${flag.reason}`}>
                  {t(DUPLICATE_MESSAGE[flag.against][flag.reason], { name: flag.name })}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {submission.status === "approving" && (
          <Alert tone="warning" title={t("setup.registration.approvalUnfinished")}>
            <p>
              {submission.claimedAt
                ? t(submission.claimedBy === currentUid ? "setup.registration.claimedByYouAt" : "setup.registration.claimedByOtherAt", {
                    time: formatDateTime(submission.claimedAt),
                  })
                : t(submission.claimedBy === currentUid ? "setup.registration.claimedByYou" : "setup.registration.claimedByOther")}{" "}
              {t("setup.registration.approvingHelp")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {likelyEntities.map((entity) => (
                <Button key={entity.id} size="sm" loading={busy === `mark-${entity.id}`} disabled={busy !== null} onClick={() => void run(`mark-${entity.id}`, () => actions.markApproved(submission, entity))}>
                  {t("setup.registration.markApprovedAs", { name: entity.name })}
                </Button>
              ))}
              <Button size="sm" loading={busy === "release"} disabled={busy !== null} onClick={() => void run("release", () => actions.review("release", submission))}>
                {t("setup.registration.returnToPending")}
              </Button>
            </div>
          </Alert>
        )}
        {submission.status === "approved" && submission.approvedEntityName && (
          <p className="text-xs text-success">{t("setup.registration.addedAs", { name: submission.approvedEntityName })}</p>
        )}
        {submission.status === "rejected" && submission.rejectionReason && (
          <p className="text-xs text-fg-muted">{t("setup.registration.rejectionReason", { reason: submission.rejectionReason })}</p>
        )}
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
      </CardBody>
      {editing && (
        <EditDialog
          submission={submission}
          onClose={() => setEditing(false)}
          onSave={(data) => actions.review("edit", submission, { data })}
        />
      )}
      {rejecting && (
        <RejectDialog
          submission={submission}
          onCancel={() => setRejecting(false)}
          onConfirm={(reason) => {
            setRejecting(false);
            void run("reject", () => actions.review("reject", submission, { reason }));
          }}
        />
      )}
    </Card>
  );
}

export function RegistrationQueue({
  submissions,
  settings,
  teams,
  adjudicators,
  currentUid,
  approveBlocked,
  actions,
}: {
  submissions: RegistrationSubmission[];
  settings: RegistrationSettings;
  teams: Team[];
  adjudicators: Adjudicator[];
  currentUid: string;
  approveBlocked: string | null;
  actions: QueueActions;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("open");
  const duplicates = useMemo(() => findRegistrationDuplicates(submissions, teams, adjudicators), [submissions, teams, adjudicators]);
  const counts = {
    open: submissions.filter((item) => item.status === "pending" || item.status === "approving").length,
    approved: submissions.filter((item) => item.status === "approved").length,
    rejected: submissions.filter((item) => item.status === "rejected").length,
    all: submissions.length,
  };
  const visible = submissions.filter((item) =>
    filter === "all" ? true : filter === "open" ? item.status === "pending" || item.status === "approving" : item.status === filter
  );

  return (
    <div className="space-y-3">
      <Tabs
        id="registration-filter"
        ariaLabel={t("setup.registration.filterLabel")}
        value={filter}
        onValueChange={setFilter}
        items={[
          { value: "open", label: t("setup.registration.filterOpen"), count: counts.open },
          { value: "approved", label: t("setup.registration.filterApproved"), count: counts.approved },
          { value: "rejected", label: t("setup.registration.filterRejected"), count: counts.rejected },
          { value: "all", label: t("setup.registration.filterAll"), count: counts.all },
        ]}
      />
      <TabPanel id="registration-filter" value={filter} className="space-y-3">
        {approveBlocked && counts.open > 0 && <Alert tone="info">{approveBlocked}</Alert>}
        {visible.length === 0 ? (
          <EmptyState
            title={t(filter === "open" ? "setup.registration.emptyOpen" : "setup.registration.emptyOther")}
            description={t("setup.registration.emptyDescription")}
          />
        ) : (
          visible.map((submission) => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              questions={
                submission.kind === "team"
                  ? settings.teamQuestions
                  : submission.kind === "adjudicator" ? settings.adjudicatorQuestions : settings.institutionQuestions ?? []
              }
              duplicates={duplicates.get(submission.id) ?? []}
              likelyEntities={submission.status === "approving" ? likelyCreatedEntities(submission, teams, adjudicators) : []}
              currentUid={currentUid}
              approveBlocked={approveBlocked}
              actions={actions}
              settings={settings}
            />
          ))
        )}
      </TabPanel>
    </div>
  );
}
