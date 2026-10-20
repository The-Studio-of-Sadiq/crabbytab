"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { FeedbackQuestionFields } from "@/components/feedback/FeedbackQuestionFields";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import {
  ballotSubmitters,
  buildPublicBallotRecord,
  buildPublicFeedbackRecord,
  canUsePublicBallot,
  feedbackSources,
  publicFormRounds,
  ranksFromTotals,
  submissionNonce,
} from "@/lib/publicFormEntries";
import { feedbackTargetsForSource } from "@/lib/feedback/progress";
import { feedbackPathsForRound } from "@/lib/feedback/paths";
import { questionsForFeedbackSource } from "@/lib/feedback/questions";
import type { DebateSide, FeedbackAnswer } from "@/types";

const BP_SIDES: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: DebateSide[] = ["AFF", "NEG"];

async function submitPublicForm(slug: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error || "");
}

function FormShell({ slug, title, children }: { slug: string; title: string; children: React.ReactNode }) {
  const { tournament, loading, cloudLoadError } = useTournament();
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      <header className="bg-[#24292e] text-white py-4 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/${encodeURIComponent(slug)}/public`} className="inline-flex items-center gap-1 text-[11px] text-gray-300 hover:text-white">
              <ArrowLeft className="w-3 h-3 rtl:-scale-x-100" aria-hidden="true" />
              {t("public.record.back")}
            </Link>
            <p className="text-sm font-bold truncate">{tournament?.name || t("public.defaultTitle")}</p>
          </div>
          <LanguageSwitcher triggerClassName="shrink-0 text-gray-100 hover:bg-white/10 hover:text-white" />
        </div>
      </header>
      <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 space-y-4 flex-1">
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
        {loading ? (
          <p role="status" className="text-xs text-gray-500">{t("public.loading")}</p>
        ) : cloudLoadError ? (
          <Alert tone="danger" role="alert">{cloudLoadError}</Alert>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

/** Honeypot, fill-time stamp, optional password and the submit state shared by both forms. */
function useSubmission(slug: string) {
  const startedAt = useRef(0);
  const [honeypot, setHoneypot] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const send = async (body: Record<string, unknown>, fallbackError: string) => {
    setBusy(true);
    setError("");
    try {
      await submitPublicForm(slug, {
        ...body,
        ...(password ? { password } : {}),
        website: honeypot,
        startedAt: startedAt.current,
      });
      setReceived(true);
    } catch (caught) {
      setError((caught instanceof Error && caught.message) || fallbackError);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setReceived(false);
    setError("");
    startedAt.current = Date.now();
  };
  return { honeypot, setHoneypot, password, setPassword, busy, error, setError, received, send, reset };
}

function SubmissionExtras({
  usesPassword,
  submission,
}: {
  usesPassword: boolean;
  submission: ReturnType<typeof useSubmission>;
}) {
  const { t } = useI18n();
  return (
    <>
      {usesPassword && (
        <Input
          type="password"
          label={t("publicForms.password")}
          help={t("publicForms.passwordHint")}
          value={submission.password}
          onChange={(event) => submission.setPassword(event.target.value)}
          autoComplete="off"
          required
          wrapperClassName="max-w-xs"
        />
      )}
      {/* Honeypot: hidden from people and assistive technology; automated form fillers complete it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={submission.honeypot} onChange={(event) => submission.setHoneypot(event.target.value)} />
        </label>
      </div>
      <p className="text-[11px] text-gray-500">{t("publicForms.unconfirmedNote")}</p>
    </>
  );
}

function Received({ onAnother }: { onAnother: () => void }) {
  const { t } = useI18n();
  return (
    <Alert tone="success" role="status" title={t("publicForms.received")}>
      <Button type="button" size="sm" className="mt-2" onClick={onAnother}>{t("publicForms.another")}</Button>
    </Alert>
  );
}

export function PublicBallotFormPage({ slug }: { slug: string }) {
  const { tournament, rounds, debates, teams } = useTournament();
  const { t, formatNumber } = useI18n();
  const settings = getPublicSiteSettings(tournament?.preferences);
  const submission = useSubmission(slug);
  const formRounds = publicFormRounds(rounds);
  const [roundId, setRoundId] = useState("");
  const round = formRounds.find((item) => item.id === roundId) ?? formRounds[0];
  const submitters = round ? ballotSubmitters(debates, round.id) : [];
  const [adjudicatorId, setAdjudicatorId] = useState("");
  const submitter = submitters.find((item) => item.id === adjudicatorId);
  const debate = submitter ? debates.find((item) => item.id === submitter.debateId) : undefined;
  const isBP = tournament?.format === "bp";
  const sides = isBP ? BP_SIDES : TWO_TEAM_SIDES;
  const replyEnabled = Boolean(tournament?.preferences?.replyScoresEnabled && !isBP);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [replySpeakers, setReplySpeakers] = useState<Record<string, string>>({});
  const [manualRanks, setManualRanks] = useState<Partial<Record<DebateSide, number>>>({});

  useEffect(() => {
    setScores({});
    setReplySpeakers({});
    setManualRanks({});
  }, [adjudicatorId, roundId]);

  if (!settings.ballotForm) {
    return <FormShell slug={slug} title={t("publicForms.ballotTitle")}><Alert>{t("publicForms.closed")}</Alert></FormShell>;
  }

  const speakersOf = (side: DebateSide) => teamsById.get(debate?.teams?.[side]?.teamId ?? "")?.speakers ?? [];
  const value = (key: string) => (scores[key] === undefined || scores[key] === "" ? undefined : Number(scores[key]));
  const totals = Object.fromEntries(
    sides.map((side) => {
      const values = speakersOf(side).map((_, index) => value(`${side}-${index}`));
      const reply = replyEnabled ? value(`${side}-reply`) : 0;
      const all = [...values, reply];
      return [side, all.every((item) => item !== undefined && Number.isFinite(item)) ? all.reduce<number>((sum, item) => sum + (item ?? 0), 0) : undefined];
    })
  ) as Partial<Record<DebateSide, number>>;
  const autoRanks = ranksFromTotals(totals, sides);
  const ranks: Partial<Record<DebateSide, number>> = { ...(autoRanks ?? {}), ...manualRanks };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!debate || !submitter) return;
    if (sides.some((side) => totals[side] === undefined)) return submission.setError(t("publicForms.missingScores"));
    if (new Set(sides.map((side) => ranks[side])).size !== sides.length || sides.some((side) => !ranks[side])) {
      return submission.setError(autoRanks ? t("publicForms.duplicateRanks") : t("publicForms.tiedTotals"));
    }
    const record = buildPublicBallotRecord({
      debate,
      adjudicatorId: submitter.id,
      sides,
      teamsById,
      scores: Object.fromEntries(sides.map((side) => [side, speakersOf(side).map((_, index) => value(`${side}-${index}`) ?? NaN)])),
      ...(replyEnabled
        ? {
            replies: Object.fromEntries(
              sides.map((side) => [side, { speakerId: replySpeakers[side] || speakersOf(side)[0]?.id || "", score: value(`${side}-reply`) ?? NaN }])
            ),
          }
        : {}),
      ranks,
      nonce: submissionNonce(),
    });
    await submission.send({ kind: "ballot", participantType: "adjudicator", participantId: submitter.id, record }, t("publicForms.failed"));
  };

  return (
    <FormShell slug={slug} title={t("publicForms.ballotTitle")}>
      {submission.received ? (
        <Received onAnother={() => { submission.reset(); setAdjudicatorId(""); }} />
      ) : formRounds.length === 0 ? (
        <Alert>{t("publicForms.noRounds")}</Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 relative">
          <Card>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Select label={t("publicForms.round")} value={round?.id ?? ""} onChange={(event) => { setRoundId(event.target.value); setAdjudicatorId(""); }}>
                {formRounds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              <Select label={t("publicForms.you")} value={adjudicatorId} onChange={(event) => setAdjudicatorId(event.target.value)} required>
                <option value="">{t("publicForms.choose")}</option>
                {submitters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </CardBody>
          </Card>

          {debate && !canUsePublicBallot(debate) && <Alert tone="warning">{t("publicForms.unsupportedDebate")}</Alert>}

          {debate && canUsePublicBallot(debate) && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {sides.map((side) => {
                  const speakers = speakersOf(side);
                  return (
                    <Card key={side}>
                      <CardHeader
                        headingLevel="h3"
                        title={`${t(`side.${side}`)} · ${debate.teams?.[side]?.teamName || t("public.noPublicName")}`}
                        description={totals[side] !== undefined ? t("publicForms.total", { total: formatNumber(totals[side]!) }) : undefined}
                      />
                      <CardBody className="space-y-2">
                        {speakers.map((speaker, index) => (
                          <Input
                            key={speaker.id}
                            type="number"
                            inputMode="decimal"
                            step={tournament?.preferences?.stepSpeakerScore ?? "any"}
                            min={tournament?.preferences?.minSpeakerScore}
                            max={tournament?.preferences?.maxSpeakerScore}
                            label={`${t("publicForms.speaker", { position: index + 1 })} · ${speaker.name || t("public.redacted")}`}
                            value={scores[`${side}-${index}`] ?? ""}
                            onChange={(event) => setScores((current) => ({ ...current, [`${side}-${index}`]: event.target.value }))}
                            required
                          />
                        ))}
                        {replyEnabled && (
                          <div className="grid grid-cols-2 gap-2">
                            <Select
                              label={t("publicForms.replySpeaker")}
                              value={replySpeakers[side] ?? speakers[0]?.id ?? ""}
                              onChange={(event) => setReplySpeakers((current) => ({ ...current, [side]: event.target.value }))}
                            >
                              {speakers.slice(0, Math.max(1, speakers.length - 1)).map((speaker, index) => (
                                <option key={speaker.id} value={speaker.id}>{speaker.name || t("publicForms.speaker", { position: index + 1 })}</option>
                              ))}
                            </Select>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min={tournament?.preferences?.minReplyScore}
                              max={tournament?.preferences?.maxReplyScore}
                              label={t("publicForms.reply")}
                              value={scores[`${side}-reply`] ?? ""}
                              onChange={(event) => setScores((current) => ({ ...current, [`${side}-reply`]: event.target.value }))}
                              required
                            />
                          </div>
                        )}
                        <Select
                          label={t("publicForms.rank")}
                          value={ranks[side] ?? ""}
                          onChange={(event) => setManualRanks((current) => ({ ...current, [side]: Number(event.target.value) || undefined }))}
                        >
                          <option value="">—</option>
                          {sides.map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
                        </Select>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500">{autoRanks ? t("publicForms.rankHint") : t("publicForms.tiedTotals")}</p>
              <SubmissionExtras usesPassword={settings.formsUsePassword} submission={submission} />
              {submission.error && <Alert tone="danger" role="alert">{submission.error}</Alert>}
              <Button type="submit" variant="primary" loading={submission.busy} loadingText={t("publicForms.submitting")}>
                {t("publicForms.submit")}
              </Button>
            </>
          )}
        </form>
      )}
    </FormShell>
  );
}

export function PublicFeedbackFormPage({ slug }: { slug: string }) {
  const { tournament, rounds, debates } = useTournament();
  const { t } = useI18n();
  const preferences = tournament?.preferences;
  const settings = getPublicSiteSettings(preferences);
  const submission = useSubmission(slug);
  const formRounds = publicFormRounds(rounds);
  const [roundId, setRoundId] = useState("");
  const round = formRounds.find((item) => item.id === roundId) ?? formRounds[0];
  const sources = round ? feedbackSources(debates, round.id) : [];
  const [sourceKey, setSourceKey] = useState("");
  const source = sources.find((item) => `${item.type}:${item.id}` === sourceKey);
  const debate = source ? debates.find((item) => item.id === source.debateId) : undefined;
  const targets = debate && source && round
    ? feedbackTargetsForSource(debate, { sourceType: source.type, sourceId: source.id }, feedbackPathsForRound(preferences, round))
    : [];
  const panelNames = new Map(
    debate
      ? [
          [debate.adjudicators?.chairId, debate.adjudicators?.chairName] as const,
          ...(debate.adjudicators?.panellistIds ?? []).map((id, index) => [id, debate.adjudicators?.panellistNames?.[index]] as const),
          ...(debate.adjudicators?.traineeIds ?? []).map((id, index) => [id, debate.adjudicators?.traineeNames?.[index]] as const),
        ]
      : []
  );
  const [targetId, setTargetId] = useState("");
  const [score, setScore] = useState("");
  const [comments, setComments] = useState("");
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswer>>({});
  const minScore = preferences?.feedbackMinScore ?? 1;
  const maxScore = preferences?.feedbackMaxScore ?? 10;
  const questions = source ? questionsForFeedbackSource(source.type, preferences) : [];

  useEffect(() => {
    setTargetId("");
    setAnswers({});
  }, [sourceKey, roundId]);

  if (!settings.feedbackForm || preferences?.feedbackEnabled === false) {
    return <FormShell slug={slug} title={t("publicForms.feedbackTitle")}><Alert>{t("publicForms.closed")}</Alert></FormShell>;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!debate || !source || !targetId) return;
    const record = buildPublicFeedbackRecord({
      debateId: debate.id,
      source,
      targetAdjudicatorId: targetId,
      score: Number(score),
      comments,
      answers,
      nonce: submissionNonce(),
    });
    await submission.send({ kind: "feedback", participantType: source.type, participantId: source.id, record }, t("publicForms.failed"));
  };

  return (
    <FormShell slug={slug} title={t("publicForms.feedbackTitle")}>
      {submission.received ? (
        <Received onAnother={() => { submission.reset(); setTargetId(""); setScore(""); setComments(""); setAnswers({}); }} />
      ) : formRounds.length === 0 ? (
        <Alert>{t("publicForms.noRounds")}</Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 relative">
          <Card>
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Select label={t("publicForms.round")} value={round?.id ?? ""} onChange={(event) => { setRoundId(event.target.value); setSourceKey(""); }}>
                {formRounds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              <Select label={t("publicForms.you")} value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} required>
                <option value="">{t("publicForms.choose")}</option>
                {sources.map((item) => (
                  <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>
                    {item.name} ({item.type === "team" ? t("lists.col.team") : t("lists.col.adjudicator")})
                  </option>
                ))}
              </Select>
            </CardBody>
          </Card>

          {source && targets.length === 0 && <Alert>{t("publicForms.noTargets")}</Alert>}

          {source && targets.length > 0 && (
            <Card>
              <CardBody className="space-y-3">
                <Select label={t("publicForms.target")} value={targetId} onChange={(event) => setTargetId(event.target.value)} required>
                  <option value="">{t("publicForms.choose")}</option>
                  {targets.map((target) => (
                    <option key={target.targetAdjudicatorId} value={target.targetAdjudicatorId}>
                      {panelNames.get(target.targetAdjudicatorId) || t("public.redacted")} ({t(`public.role.${target.targetRole}`)})
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={minScore}
                  max={maxScore}
                  step="any"
                  label={t("publicForms.score", { min: minScore, max: maxScore })}
                  value={score}
                  onChange={(event) => setScore(event.target.value)}
                  required
                  wrapperClassName="max-w-xs"
                />
                {questions.length > 0 && (
                  <FeedbackQuestionFields
                    questions={questions}
                    answers={answers}
                    onChange={(questionId, answer) => setAnswers((current) => ({ ...current, [questionId]: answer }))}
                  />
                )}
                <Textarea label={t("publicForms.comments")} rows={4} maxLength={5000} value={comments} onChange={(event) => setComments(event.target.value)} />
                <SubmissionExtras usesPassword={settings.formsUsePassword} submission={submission} />
                {submission.error && <Alert tone="danger" role="alert">{submission.error}</Alert>}
                <Button type="submit" variant="primary" loading={submission.busy} loadingText={t("publicForms.submitting")}>
                  {t("publicForms.submit")}
                </Button>
              </CardBody>
            </Card>
          )}
        </form>
      )}
    </FormShell>
  );
}
