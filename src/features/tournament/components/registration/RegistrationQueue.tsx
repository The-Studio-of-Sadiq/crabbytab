"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Pencil, RotateCcw, XCircle } from "lucide-react";
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

const STATUS: Record<RegistrationSubmission["status"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "info" },
  approving: { label: "Being approved", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
};

const REASON: Record<DuplicateFlag["reason"], string> = {
  same_name: "same name",
  same_email: "same email",
  same_speaker: "a speaker with the same email",
};

function formatAnswer(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}

function entryName(submission: RegistrationSubmission): string {
  if (submission.kind === "institution") return submission.institution?.name ?? "(unnamed)";
  return (submission.kind === "team" ? submission.team?.name : submission.adjudicator?.name) ?? "(unnamed)";
}

const KIND_LABEL: Record<RegistrationSubmission["kind"], { label: string; tone: Tone }> = {
  team: { label: "Team", tone: "accent" },
  adjudicator: { label: "Adjudicator", tone: "neutral" },
  institution: { label: "Institution", tone: "info" },
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
  const [teams, setTeams] = useState(String(submission.institutionRequest?.teamsRequested ?? 0));
  const [adjudicators, setAdjudicators] = useState(String(submission.institutionRequest?.adjudicatorsRequested ?? 0));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input label="Team places" type="number" min={0} max={1000} value={teams} onChange={(event) => setTeams(event.target.value)} wrapperClassName="w-28" />
      <Input
        label="Adjudicator places"
        type="number"
        min={0}
        max={1000}
        value={adjudicators}
        onChange={(event) => setAdjudicators(event.target.value)}
        wrapperClassName="w-32"
      />
      <Button size="sm" variant="primary" loading={busy} onClick={() => onAllocate(Number(teams) || 0, Number(adjudicators) || 0)}>
        <CheckCircle2 aria-hidden="true" />
        Allocate places and send link
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
      setError(saveError instanceof Error ? saveError.message : "Could not save the changes.");
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
      title={`Edit ${entryName(submission)}`}
      description="Changes are validated like the public form; limits and the registration window do not apply to administrators."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Institution" value={institution} onChange={(event) => setInstitution(event.target.value)} />
          <Input label="Contact name" value={contactName} onChange={(event) => setContactName(event.target.value)} />
          <Input label="Contact email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
        </div>
        {submission.kind === "team" ? (
          <>
            <Input label="Team name" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            {speakers.map((speaker, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <Input
                  label={`Speaker ${index + 1}`}
                  value={speaker.name}
                  onChange={(event) => setSpeakers((current) => current.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))}
                />
                <Input
                  label="Email"
                  type="email"
                  value={speaker.email}
                  onChange={(event) => setSpeakers((current) => current.map((item, position) => (position === index ? { ...item, email: event.target.value } : item)))}
                />
                <Input
                  label="Categories"
                  value={speaker.categories}
                  onChange={(event) => setSpeakers((current) => current.map((item, position) => (position === index ? { ...item, categories: event.target.value } : item)))}
                />
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Adjudicator name" value={adjudicatorName} onChange={(event) => setAdjudicatorName(event.target.value)} />
              <Input label="Adjudicator email" type="email" value={adjudicatorEmail} onChange={(event) => setAdjudicatorEmail(event.target.value)} />
            </div>
            <Textarea label="Institution conflicts (one per line)" rows={3} value={institutionConflicts} onChange={(event) => setInstitutionConflicts(event.target.value)} />
            <Textarea label="Team or person conflicts (one per line)" rows={3} value={teamConflicts} onChange={(event) => setTeamConflicts(event.target.value)} />
          </>
        )}
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
      </div>
    </Dialog>
  );
}

function SubmissionCard({
  submission,
  questions,
  duplicates,
  likelyEntities,
  currentUid,
  approveBlocked,
  actions,
}: {
  submission: RegistrationSubmission;
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
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update this submission.");
    } finally {
      setBusy(null);
    }
  };
  const status = STATUS[submission.status];
  const answered = questions.filter((question) => formatAnswer(submission.answers[question.id]) !== "");

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
              {entryName(submission)}
              <Badge tone={KIND_LABEL[submission.kind].tone}>{KIND_LABEL[submission.kind].label}</Badge>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
              {submission.overAllocated && submission.status !== "rejected" && (
                <StatusPill tone="warning">Above the institution&apos;s places</StatusPill>
              )}
              {submission.autoApproved && <Badge tone="success">Accepted automatically</Badge>}
              {duplicates.length > 0 && submission.status !== "approved" && <StatusPill tone="warning">Possible duplicate</StatusPill>}
            </h3>
            <p className="text-xs text-fg-muted">
              {submission.institution?.name ?? "No institution"} · {submission.contactName} ({submission.contactEmail}) ·{" "}
              {new Date(submission.submittedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              {submission.representativeId ? " · via representative link" : ""}
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
                  Approve
                </Button>
                <Button size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              </>
            )}
            {(submission.status === "pending" || submission.status === "approving") && (
              <Button
                size="sm"
                variant="danger"
                loading={busy === "reject"}
                disabled={busy !== null}
                onClick={() => {
                  const reason = window.prompt(`Reject ${entryName(submission)}? Optionally give a reason (kept for administrators).`, "");
                  if (reason === null) return;
                  void run("reject", () => actions.review("reject", submission, { reason }));
                }}
              >
                <XCircle aria-hidden="true" />
                Reject
              </Button>
            )}
            {submission.status === "rejected" && (
              <Button size="sm" loading={busy === "reopen"} disabled={busy !== null} onClick={() => void run("reopen", () => actions.review("reopen", submission))}>
                <RotateCcw aria-hidden="true" />
                Reopen
              </Button>
            )}
          </div>
        </div>

        {submission.kind === "institution" && submission.institutionRequest && (
          <div className="space-y-2 text-xs text-fg">
            <p>
              Asks for {submission.institutionRequest.teamsRequested} team place(s) and{" "}
              {submission.institutionRequest.adjudicatorsRequested} adjudicator place(s)
              {submission.institutionRequest.code ? ` · code ${submission.institutionRequest.code}` : ""}
              {submission.institutionRequest.region ? ` · ${submission.institutionRequest.region}` : ""}.
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
                Allocated {submission.teamsAllocated ?? 0} team and {submission.adjudicatorsAllocated ?? 0} adjudicator place(s); the
                coach is the institution&apos;s representative.
              </p>
            )}
          </div>
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
              <p><span className="text-fg-muted">Institution conflicts:</span> {submission.adjudicator.institutionConflicts.join(", ")}</p>
            )}
            {submission.adjudicator.teamConflicts.length > 0 && (
              <p><span className="text-fg-muted">Team or person conflicts:</span> {submission.adjudicator.teamConflicts.join(", ")}</p>
            )}
          </div>
        )}
        {answered.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
            {answered.map((question) => (
              <React.Fragment key={question.id}>
                <dt className="text-fg-muted">{question.label}</dt>
                <dd className="text-fg">{formatAnswer(submission.answers[question.id])}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {duplicates.length > 0 && submission.status !== "approved" && (
          <Alert tone="warning" title="Possible duplicate">
            <ul>
              {duplicates.map((flag) => (
                <li key={`${flag.against}-${flag.id}-${flag.reason}`}>
                  {flag.against === "submission" ? "Another registration" : flag.against === "team" ? "Existing team" : "Existing adjudicator"}{" "}
                  “{flag.name}” has {REASON[flag.reason]}.
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {submission.status === "approving" && (
          <Alert tone="warning" title="Approval not finished">
            <p>
              Claimed by {submission.claimedBy === currentUid ? "you" : "another administrator"}
              {submission.claimedAt ? ` at ${new Date(submission.claimedAt).toLocaleString()}` : ""}. If the record was created, mark it approved; otherwise return it to pending.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {likelyEntities.map((entity) => (
                <Button key={entity.id} size="sm" loading={busy === `mark-${entity.id}`} disabled={busy !== null} onClick={() => void run(`mark-${entity.id}`, () => actions.markApproved(submission, entity))}>
                  Mark approved as {entity.name}
                </Button>
              ))}
              <Button size="sm" loading={busy === "release"} disabled={busy !== null} onClick={() => void run("release", () => actions.review("release", submission))}>
                Return to pending
              </Button>
            </div>
          </Alert>
        )}
        {submission.status === "approved" && submission.approvedEntityName && (
          <p className="text-xs text-success">Added as {submission.approvedEntityName}.</p>
        )}
        {submission.status === "rejected" && submission.rejectionReason && (
          <p className="text-xs text-fg-muted">Reason: {submission.rejectionReason}</p>
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
        ariaLabel="Filter submissions"
        value={filter}
        onValueChange={setFilter}
        items={[
          { value: "open", label: "To review", count: counts.open },
          { value: "approved", label: "Approved", count: counts.approved },
          { value: "rejected", label: "Rejected", count: counts.rejected },
          { value: "all", label: "All", count: counts.all },
        ]}
      />
      <TabPanel id="registration-filter" value={filter} className="space-y-3">
        {approveBlocked && counts.open > 0 && <Alert tone="info">{approveBlocked}</Alert>}
        {visible.length === 0 ? (
          <EmptyState title={filter === "open" ? "Nothing to review" : "No submissions here"} description="New registrations appear here as they arrive; reload to check for more." />
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
            />
          ))
        )}
      </TabPanel>
    </div>
  );
}
