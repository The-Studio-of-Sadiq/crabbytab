"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Building2, Gavel, Plus, Trash2, Users } from "lucide-react";
import type { FeedbackAnswer } from "@/types";
import type { PublicRegistrationForm } from "@/lib/registration/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { FeedbackQuestionFields } from "@/components/feedback/FeedbackQuestionFields";
import { PublicFormShell } from "@/components/public/PublicFormShell";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";

interface RepresentativeView {
  institutionName: string;
  name: string;
  remaining: { team: number | null; adjudicator: number | null };
  transferTargets?: Array<{ id: string; institutionName: string }>;
}

interface SpeakerDraft {
  name: string;
  email: string;
  categories: string[];
  phone: string;
  gender: string;
  answers: Record<string, FeedbackAnswer>;
}

type Kind = "team" | "adjudicator" | "institution";

const emptySpeaker = (): SpeakerDraft => ({ name: "", email: "", categories: [], phone: "", gender: "", answers: {} });

/** Places a representative asks to give to another institution (slot transfers). */
function TransferForm({
  slug,
  token,
  targets,
}: {
  slug: string;
  token: string;
  targets: Array<{ id: string; institutionName: string }>;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [teams, setTeams] = useState("0");
  const [adjudicators, setAdjudicators] = useState("0");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const submit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transfer", token, transfer: { toRepresentativeId: target, teams, adjudicators } }),
        cache: "no-store",
      });
      const result = await readJson<{ transfer?: unknown }>(response);
      if (!response.ok) throw new Error(result.error || t("register.transferFailed"));
      setStatus({ tone: "success", text: t("register.transferSent") });
    } catch (transferError) {
      setStatus({ tone: "danger", text: transferError instanceof Error ? transferError.message : t("register.transferFailed") });
    } finally {
      setBusy(false);
    }
  };
  if (targets.length === 0) return null;
  return (
    <Card>
      <CardHeader title={t("register.transferTitle")} description={t("register.transferHelp")} />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t("register.transferTo")} value={target} onChange={(event) => setTarget(event.target.value)}>
            {targets.map((item) => (
              <option key={item.id} value={item.id}>{item.institutionName}</option>
            ))}
          </Select>
          <Input label={t("register.transferTeams")} type="number" min={0} max={100} value={teams} onChange={(event) => setTeams(event.target.value)} />
          <Input
            label={t("register.transferAdjudicators")}
            type="number"
            min={0}
            max={100}
            value={adjudicators}
            onChange={(event) => setAdjudicators(event.target.value)}
          />
        </div>
        {status && <Alert tone={status.tone} role={status.tone === "danger" ? "alert" : "status"}>{status.text}</Alert>}
        <Button loading={busy} onClick={() => void submit()}>{t("register.transferSubmit")}</Button>
      </CardBody>
    </Card>
  );
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export default function RegistrationPage() {
  const params = useParams();
  const slug = String(params.slug ?? "");
  const { t, formatDateTime } = useI18n();
  const [form, setForm] = useState<PublicRegistrationForm | null>(null);
  const [loadError, setLoadError] = useState("");
  const [representativeToken, setRepresentativeToken] = useState("");
  const [representative, setRepresentative] = useState<RepresentativeView | null>(null);
  const [kind, setKind] = useState<Kind>("team");
  const [institution, setInstitution] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [teamName, setTeamName] = useState("");
  const [speakers, setSpeakers] = useState<SpeakerDraft[]>([]);
  const [adjudicatorName, setAdjudicatorName] = useState("");
  const [adjudicatorEmail, setAdjudicatorEmail] = useState("");
  const [institutionConflicts, setInstitutionConflicts] = useState("");
  const [teamConflicts, setTeamConflicts] = useState("");
  const [adjudicatorPhone, setAdjudicatorPhone] = useState("");
  const [adjudicatorGender, setAdjudicatorGender] = useState("");
  const [institutionCode, setInstitutionCode] = useState("");
  const [institutionRegion, setInstitutionRegion] = useState("");
  const [teamsRequested, setTeamsRequested] = useState("0");
  const [adjudicatorsRequested, setAdjudicatorsRequested] = useState("0");
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswer>>({});
  const [honeypot, setHoneypot] = useState("");
  const startedAt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submittedKind, setSubmittedKind] = useState<Kind | null>(null);

  const loadRepresentative = useCallback(
    async (token: string) => {
      const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "representative", token }),
        cache: "no-store",
      });
      const result = await readJson<{ representative?: RepresentativeView }>(response);
      if (!response.ok || !result.representative) throw new Error(result.error || t("register.linkInvalid"));
      setRepresentative(result.representative);
    },
    [slug, t]
  );

  useEffect(() => {
    let active = true;
    const token = window.location.hash.replace(/^#/, "").trim();
    setRepresentativeToken(token);
    startedAt.current = Date.now();
    (async () => {
      try {
        const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/registration`);
        const result = await readJson<{ form?: PublicRegistrationForm }>(response);
        if (!response.ok || !result.form) throw new Error(result.error || t("register.loadFailed"));
        if (!active) return;
        setForm(result.form);
        setKind(result.form.teamRegistration ? "team" : result.form.adjudicatorRegistration ? "adjudicator" : "institution");
        setSpeakers(Array.from({ length: result.form.minSpeakers }, emptySpeaker));
        if (token) await loadRepresentative(token);
      } catch (loadFailure) {
        if (active) setLoadError(loadFailure instanceof Error ? loadFailure.message : t("register.loadFailed"));
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, t, loadRepresentative]);

  const resetEntry = () => {
    setTeamName("");
    setSpeakers(Array.from({ length: form?.minSpeakers ?? 2 }, emptySpeaker));
    setAdjudicatorName("");
    setAdjudicatorEmail("");
    setInstitutionConflicts("");
    setTeamConflicts("");
    setAdjudicatorPhone("");
    setAdjudicatorGender("");
    setInstitutionCode("");
    setInstitutionRegion("");
    setTeamsRequested("0");
    setAdjudicatorsRequested("0");
    setAnswers({});
    setError("");
    setSubmittedKind(null);
    startedAt.current = Date.now();
  };

  const updateSpeaker = (index: number, change: Partial<SpeakerDraft>) =>
    setSpeakers((current) => current.map((speaker, position) => (position === index ? { ...speaker, ...change } : speaker)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError("");
    const lines = (value: string) => value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const registration = {
      kind,
      institution: representative ? undefined : institution,
      contactName,
      contactEmail,
      answers,
      ...(kind === "team"
        ? {
            team: {
              name: teamName,
              speakers: speakers.map((speaker) => ({
                name: speaker.name,
                categories: speaker.categories,
                email: speaker.email.trim() || undefined,
                phone: speaker.phone.trim() || undefined,
                gender: speaker.gender.trim() || undefined,
                answers: speaker.answers,
              })),
            },
          }
        : kind === "institution"
          ? {
              institutionRequest: {
                code: institutionCode,
                region: institutionRegion,
                teamsRequested,
                adjudicatorsRequested,
              },
            }
          : {
              adjudicator: {
                name: adjudicatorName,
                email: adjudicatorEmail,
                institutionConflicts: lines(institutionConflicts),
                teamConflicts: lines(teamConflicts),
                phone: adjudicatorPhone.trim() || undefined,
                gender: adjudicatorGender.trim() || undefined,
              },
            }),
    };
    try {
      const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          registration,
          representativeToken: representativeToken || undefined,
          website: honeypot,
          startedAt: startedAt.current,
        }),
        cache: "no-store",
      });
      const result = await readJson<{ received?: boolean }>(response);
      if (!response.ok) throw new Error(result.error || t("register.submitFailed"));
      setSubmittedKind(kind);
      if (representativeToken) await loadRepresentative(representativeToken).catch(() => setRepresentative(null));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("register.submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  const formatTime = (value: string) => formatDateTime(value, { dateStyle: "medium", timeStyle: "short" });
  const questions = form
    ? kind === "team" ? form.teamQuestions : kind === "adjudicator" ? form.adjudicatorQuestions : form.institutionQuestions
    : [];
  const remaining = representative && kind !== "institution" ? representative.remaining[kind] : null;
  const kindMessage = form ? (kind === "team" ? form.teamMessage : kind === "adjudicator" ? form.adjudicatorMessage : form.institutionMessage) : "";
  const kinds: Kind[] = form
    ? ([
        form.teamRegistration ? "team" : null,
        form.adjudicatorRegistration ? "adjudicator" : null,
        form.institutionRegistration && !representative ? "institution" : null,
      ].filter(Boolean) as Kind[])
    : [];
  const needsRepresentative = Boolean(form?.representativesOnly && !representative);

  let body: React.ReactNode;
  if (loadError && !form) {
    body = <Alert tone="danger" role="alert" title={t("register.unavailableTitle")}>{loadError}</Alert>;
  } else if (!form) {
    body = <p className="text-[13px] text-fg-muted" role="status">{t("register.loading")}</p>;
  } else if (form.state !== "open") {
    body = (
      <Alert tone="warning" role="status" title={t("register.closedTitle")}>
        {form.state === "not_open" && form.opensAt
          ? t("register.notOpen", { time: formatTime(form.opensAt) })
          : form.state === "closed"
            ? t("register.closed")
            : t("register.disabled")}
      </Alert>
    );
  } else if (submittedKind) {
    body = (
      <Alert tone="success" role="status" title={t("register.receivedTitle")}>
        <p>
          {submittedKind === "team"
            ? t("register.receivedTeam")
            : submittedKind === "adjudicator" ? t("register.receivedAdjudicator") : t("register.receivedInstitution")}
        </p>
        <Button className="mt-3" onClick={resetEntry}>{t("register.another")}</Button>
      </Alert>
    );
  } else {
    body = (
      <form onSubmit={submit} className="space-y-4">
        {loadError && <Alert tone="danger" role="alert">{loadError}</Alert>}
        {needsRepresentative && (
          <Alert tone="warning" role="alert" title={t("register.representativesOnlyTitle")}>
            {t("register.representativesOnly")}
          </Alert>
        )}
        {representative && (
          <Alert tone="info" role="status" title={t("register.representativeTitle", { institution: representative.institutionName })}>
            {remaining === null
              ? t("register.representativeUnlimited")
              : t("register.representativeRemaining", { count: String(remaining) })}
          </Alert>
        )}

        {representative?.transferTargets && representativeToken && (
          <TransferForm slug={slug} token={representativeToken} targets={representative.transferTargets} />
        )}

        {kinds.length > 1 && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-xs font-medium text-fg">{t("register.kindLegend")}</legend>
            {kinds.map((option) => (
              <Button
                key={option}
                variant={kind === option ? "primary" : "secondary"}
                aria-pressed={kind === option}
                onClick={() => {
                  setKind(option);
                  setAnswers({});
                }}
              >
                {option === "team" ? <Users aria-hidden="true" /> : option === "adjudicator" ? <Gavel aria-hidden="true" /> : <Building2 aria-hidden="true" />}
                {option === "team" ? t("register.kindTeam") : option === "adjudicator" ? t("register.kindAdjudicator") : t("register.kindInstitution")}
              </Button>
            ))}
          </fieldset>
        )}

        {kindMessage && <p className="whitespace-pre-line text-[13px] text-fg-muted">{kindMessage}</p>}

        <Card>
          <CardHeader title={t("register.aboutYou")} />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Input label={t("register.contactName")} required maxLength={120} autoComplete="name" value={contactName} onChange={(event) => setContactName(event.target.value)} />
            <Input label={t("register.contactEmail")} type="email" required maxLength={254} autoComplete="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
            {representative ? (
              <p className="text-[13px] text-fg-muted sm:col-span-2">{t("register.institutionFixed", { institution: representative.institutionName })}</p>
            ) : (
              <Input
                label={kind === "institution" ? t("register.institutionName") : t("register.institution")}
                help={kind === "institution" ? undefined : t("register.institutionHelp")}
                required={kind === "institution"}
                wrapperClassName="sm:col-span-2"
                maxLength={120}
                autoComplete="organization"
                value={institution}
                onChange={(event) => setInstitution(event.target.value)}
              />
            )}
          </CardBody>
        </Card>

        {kind === "team" ? (
          <Card>
            <CardHeader title={t("register.teamSection")} description={
              form.minSpeakers === form.maxSpeakers
                ? t("register.speakersExact", { count: String(form.minSpeakers) })
                : t("register.speakersRange", { min: String(form.minSpeakers), max: String(form.maxSpeakers) })
            } />
            <CardBody className="space-y-4">
              <Input label={t("register.teamName")} required maxLength={120} value={teamName} onChange={(event) => setTeamName(event.target.value)} />
              {speakers.map((speaker, index) => (
                <fieldset key={index} className="space-y-2 rounded-md border border-border p-3">
                  <legend className="px-1 text-xs font-medium text-fg">{t("register.speaker", { number: String(index + 1) })}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label={t("register.speakerName")} required maxLength={120} value={speaker.name} onChange={(event) => updateSpeaker(index, { name: event.target.value })} />
                    <Input label={t("register.speakerEmail")} type="email" maxLength={254} value={speaker.email} onChange={(event) => updateSpeaker(index, { email: event.target.value })} />
                  </div>
                  {(form.speakerFields.includes("phone") || form.speakerFields.includes("gender")) && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {form.speakerFields.includes("phone") && (
                        <Input label={t("register.phone")} type="tel" maxLength={30} autoComplete="tel" value={speaker.phone} onChange={(event) => updateSpeaker(index, { phone: event.target.value })} />
                      )}
                      {form.speakerFields.includes("gender") && (
                        <Input label={t("register.gender")} maxLength={40} value={speaker.gender} onChange={(event) => updateSpeaker(index, { gender: event.target.value })} />
                      )}
                    </div>
                  )}
                  {form.speakerQuestions.length > 0 && (
                    <FeedbackQuestionFields
                      questions={form.speakerQuestions}
                      answers={speaker.answers}
                      onChange={(id, value) => updateSpeaker(index, { answers: { ...speaker.answers, [id]: value } })}
                    />
                  )}
                  {form.speakerCategories.length > 0 && (
                    <div className="flex flex-wrap gap-4" role="group" aria-label={t("register.speakerCategories")}>
                      {form.speakerCategories.map((category) => (
                        <Checkbox
                          key={category}
                          label={category}
                          checked={speaker.categories.includes(category)}
                          onChange={(event) =>
                            updateSpeaker(index, {
                              categories: event.target.checked
                                ? [...speaker.categories, category]
                                : speaker.categories.filter((item) => item !== category),
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                  {speakers.length > form.minSpeakers && (
                    <IconButton
                      icon={<Trash2 />}
                      label={t("register.removeSpeaker", { number: String(index + 1) })}
                      onClick={() => setSpeakers((current) => current.filter((_, position) => position !== index))}
                    />
                  )}
                </fieldset>
              ))}
              {speakers.length < form.maxSpeakers && (
                <Button onClick={() => setSpeakers((current) => [...current, emptySpeaker()])}>
                  <Plus aria-hidden="true" />
                  {t("register.addSpeaker")}
                </Button>
              )}
            </CardBody>
          </Card>
        ) : kind === "institution" ? (
          <Card>
            <CardHeader title={t("register.institutionSection")} />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Input label={t("register.institutionCode")} maxLength={12} value={institutionCode} onChange={(event) => setInstitutionCode(event.target.value)} />
              {form.institutionRegion && (
                <Input label={t("register.region")} maxLength={60} value={institutionRegion} onChange={(event) => setInstitutionRegion(event.target.value)} />
              )}
              <Input
                label={t("register.teamsRequested")}
                type="number"
                min={0}
                max={100}
                required
                value={teamsRequested}
                onChange={(event) => setTeamsRequested(event.target.value)}
              />
              <Input
                label={t("register.adjudicatorsRequested")}
                type="number"
                min={0}
                max={100}
                required
                value={adjudicatorsRequested}
                onChange={(event) => setAdjudicatorsRequested(event.target.value)}
              />
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title={t("register.adjudicatorSection")} />
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label={t("register.adjudicatorName")} required maxLength={120} value={adjudicatorName} onChange={(event) => setAdjudicatorName(event.target.value)} />
                <Input label={t("register.adjudicatorEmail")} type="email" required maxLength={254} value={adjudicatorEmail} onChange={(event) => setAdjudicatorEmail(event.target.value)} />
                {form.adjudicatorFields.includes("phone") && (
                  <Input label={t("register.phone")} type="tel" maxLength={30} autoComplete="tel" value={adjudicatorPhone} onChange={(event) => setAdjudicatorPhone(event.target.value)} />
                )}
                {form.adjudicatorFields.includes("gender") && (
                  <Input label={t("register.gender")} maxLength={40} value={adjudicatorGender} onChange={(event) => setAdjudicatorGender(event.target.value)} />
                )}
              </div>
              <Textarea
                label={t("register.institutionConflicts")}
                help={t("register.conflictsHelp")}
                rows={3}
                value={institutionConflicts}
                onChange={(event) => setInstitutionConflicts(event.target.value)}
              />
              <Textarea
                label={t("register.teamConflicts")}
                help={t("register.conflictsHelp")}
                rows={3}
                value={teamConflicts}
                onChange={(event) => setTeamConflicts(event.target.value)}
              />
            </CardBody>
          </Card>
        )}

        {questions.length > 0 && (
          <Card>
            <CardBody>
              <FeedbackQuestionFields
                questions={questions}
                answers={answers}
                onChange={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))}
              />
            </CardBody>
          </Card>
        )}

        {/* Honeypot: hidden from people and assistive technology; automated form fillers complete it. */}
        <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
          </label>
        </div>

        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        <p className="text-xs text-fg-muted">{t("register.privacy")}</p>
        <Button type="submit" variant="primary" loading={busy} disabled={needsRepresentative || remaining === 0}>
          {t("register.submit")}
        </Button>
      </form>
    );
  }

  return (
    <PublicFormShell width="lg">
      <header className="mb-5 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          {form ? t("register.title", { tournament: form.tournamentName }) : t("register.titleFallback")}
        </h1>
        {form?.state === "open" && form.closesAt && (
          <p className="text-xs text-fg-muted">
            <Badge tone="info">{t("register.open")}</Badge> {t("register.closesAt", { time: formatTime(form.closesAt) })}
          </p>
        )}
        {form?.instructions && <p className="whitespace-pre-line text-[13px] text-fg-muted">{form.instructions}</p>}
      </header>
      {body}
    </PublicFormShell>
  );
}
