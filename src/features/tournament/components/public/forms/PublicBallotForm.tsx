"use client";

import React, { useState } from "react";
import Link from "next/link";
import { FileCheck2, Loader2 } from "lucide-react";
import type { Debate, DebateSide, SpeakerScoreEntry, Team } from "@/types";
import {
  applyScoreCriteria,
  rulesSides,
  buildBallotResult,
  effectiveRanks,
  substantiveSpeakerCount,
  usesSpeakerScores,
  validateBallotEntry,
  type BallotEntry,
} from "@/lib/ballots/result";
import { speakerRanksFor, winnerDeclarationFor } from "@/lib/ballots/ballotRules";
import { privateBallotRules } from "@/lib/privateBallot";
import { isPolyFormat } from "@/lib/debateSides";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot } from "@/lib/draw/manualSides";
import { blankSpeeches } from "@/features/tournament/application/ballotEntry";
import { SpeechRows } from "@/features/tournament/components/ballot/SpeechRows";
import { MotionChoiceFields } from "@/features/tournament/components/ballot/MotionChoiceFields";
import { participantBallotAsksMotion, participantBallotAsksVetoes } from "@/lib/ballots/participantMotion";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicCenteredCard, PublicShell } from "@/components/public/PublicShell";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Label, Select } from "@/components/ui/Field";
import { SideBadge } from "@/components/ui/SideBadge";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import type { PublicFormsPerson } from "@/lib/publicForms";
import {
  postPublicForm,
  PublicFormRequestError,
  usePublicFormsDirectory,
  type PublicBallotContext,
} from "./publicFormsClient";
import { PublicFormPasswordField, PublicPersonPicker } from "./PublicFormParts";

/**
 * Tabbycat's public ballot pages (results/views.py PublicBallotSubmissionIndexView and
 * BasePublicNewBallotSetView): adjudicators of the current round pick themselves and enter their
 * ballot. Ballots are stored unconfirmed for the tab room (docs/public-pages-and-notifications.md).
 */
export function PublicBallotFormPage({ slug }: { slug: string }) {
  const { t } = useI18n();
  const { data, error, loading } = usePublicFormsDirectory(slug);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [context, setContext] = useState<PublicBallotContext | null>(null);
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const title = data?.tournament.shortName || data?.tournament.name || t("common.tournament");
  const publicHref = `/${slug}/public`;
  const directory = data?.forms?.ballot;
  const usePassword = data?.forms?.usePassword === true;

  const requestError = (caught: unknown, fallback: string) => {
    if (caught instanceof PublicFormRequestError && caught.passwordRejected) {
      setPasswordError(caught.message || t("publicForms.passwordWrong"));
      return;
    }
    setNotice({ tone: "danger", text: caught instanceof Error && caught.message ? caught.message : fallback });
  };

  const open = async (person: PublicFormsPerson) => {
    setNotice(null);
    setPasswordError("");
    if (usePassword && !password) {
      setPasswordError(t("publicForms.passwordMissing"));
      return;
    }
    setLoadingFor(person.id);
    try {
      setContext(await postPublicForm<PublicBallotContext>(slug, {
        action: "load",
        kind: "ballot",
        sourceType: "adjudicator",
        sourceId: person.id,
        ...(usePassword ? { password } : {}),
      }));
    } catch (caught) {
      requestError(caught, t("publicForms.loadFailed"));
    } finally {
      setLoadingFor(null);
    }
  };

  if (loading) {
    return (
      <PublicShell title={title} width="narrow">
        <PublicCenteredCard className="flex flex-col items-center text-center">
          <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-hidden="true" />
          <p role="status" className="text-[13px] text-fg-muted">{t("publicForms.loading")}</p>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  const closedMessage = !data
    ? error || t("publicForms.loadFailed")
    : !directory
      ? t("publicForms.ballotClosed")
      : directory.closedReason === "motions_not_released"
        ? t("publicForms.motionsNotReleased")
        : directory.closedReason
          ? t("publicForms.noBallotRound")
          : null;

  return (
    <PublicShell title={title} subtitle={t("publicForms.ballotTitle")} width="narrow" backHref={publicHref} backLabel={t("portal.visitPublic")}>
      {notice && <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</Alert>}
      {context ? (
        <PublicBallotEntry
          slug={slug}
          context={context}
          password={usePassword ? password : undefined}
          onCancel={() => setContext(null)}
          onSubmitted={(message) => {
            setContext(null);
            setNotice({ tone: "success", text: message });
          }}
          onPasswordRejected={(message) => {
            setContext(null);
            setPasswordError(message || t("publicForms.passwordWrong"));
          }}
        />
      ) : closedMessage ? (
        <EmptyState title={closedMessage} />
      ) : (
        <Card>
          <CardHeader
            icon={<FileCheck2 aria-hidden="true" />}
            title={t("publicForms.ballotPickTitle", { round: directory?.roundName ?? "" })}
            description={t("publicForms.ballotPickDescription")}
          />
          <CardBody className="space-y-4">
            {usePassword && <PublicFormPasswordField value={password} onChange={(value) => { setPassword(value); setPasswordError(""); }} error={passwordError} />}
            {directory && directory.adjudicators.length > 0 ? (
              <PublicPersonPicker
                people={directory.adjudicators}
                searchLabel={t("publicForms.searchAdjudicators")}
                actionLabel={(name) => t("publicForms.addResultFrom", { name })}
                detail={(person) => {
                  const venue = directory.adjudicators.find((item) => item.id === person.id)?.venueName;
                  return loadingFor === person.id ? t("publicForms.opening") : venue;
                }}
                onPick={(person) => void open(person)}
              />
            ) : (
              <p className="text-[13px] text-fg-muted">{t("publicForms.noAdjudicators")}</p>
            )}
          </CardBody>
        </Card>
      )}
      {!context && data?.forms?.feedback && (
        <p className="text-xs text-fg-muted">
          <Link href={`/${slug}/public/feedback`} className={cn("underline", focusRing)}>{t("publicForms.feedbackLink")}</Link>
        </p>
      )}
    </PublicShell>
  );
}

type Roster = Team["speakers"];

function PublicBallotEntry({
  slug,
  context,
  password,
  onCancel,
  onSubmitted,
  onPasswordRejected,
}: {
  slug: string;
  context: PublicBallotContext;
  password?: string;
  onCancel: () => void;
  onSubmitted: (message: string) => void;
  onPasswordRejected: (message: string) => void;
}) {
  const { t } = useI18n();
  const tournament = context.tournament;
  const rules = privateBallotRules(tournament, context.round, context.debate);
  const sides = rulesSides(rules);
  const isBP = tournament.format === "bp";
  const poly = isPolyFormat(tournament.format);
  const rosters = new Map(context.teams.map((team) => [team.id, team.speakers as Roster]));
  const drawn = context.debate;
  const manualSides = sidesChosenOnBallot(drawn);

  const entryFor = (debate: Debate): BallotEntry => ({
    speakerScores: Object.fromEntries(sides.map((side) => [
      side,
      blankSpeeches(rosters.get(debate.teams[side]?.teamId || "") || [], rules),
    ])) as Record<DebateSide, SpeakerScoreEntry[]>,
    ranks: Object.fromEntries(sides.map((side, index) => [side, index + 1])),
    ...(poly ? { winners: [] } : {}),
    motionId: debate.motionId || "",
  });

  const initialArrangement = (): { debate: Debate; chosen: boolean } => {
    if (!manualSides) return { debate: drawn, chosen: true };
    if (drawn.sidesConfirmed) return { debate: drawn, chosen: true };
    return { debate: drawn, chosen: false };
  };
  const [{ debate, chosen }, setArrangement] = useState(initialArrangement);
  const [entry, setEntry] = useState<BallotEntry>(() => entryFor(initialArrangement().debate));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Several motions: the adjudicator says which was debated (and, with vetoes on, each team's veto).
  const roundMotions = context.motions ?? [];
  const asksMotion = participantBallotAsksMotion(tournament.preferences, roundMotions);
  const asksVetoes = participantBallotAsksVetoes(tournament.preferences, roundMotions);
  const [motionId, setMotionId] = useState("");
  const [vetoes, setVetoes] = useState<Partial<Record<DebateSide, string>>>({});

  const chooseAffirmative = (affTeamId: string) => {
    const negTeamId = [drawn.teams.AFF?.teamId, drawn.teams.NEG?.teamId].find((id) => id && id !== affTeamId);
    const assignment = { AFF: affTeamId, NEG: negTeamId };
    if (!isSidePermutation(drawn, assignment)) return;
    const arranged = arrangeDebateSides(drawn, assignment);
    setArrangement({ debate: arranged, chosen: true });
    setEntry(entryFor(arranged));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!chosen) {
      setError(t("adjPortal.ballot.chooseSides"));
      return;
    }
    if (asksMotion && !roundMotions.some((motion) => motion.id === motionId)) {
      setError(t("adjPortal.ballot.chooseMotion"));
      return;
    }
    const sideRosters = Object.fromEntries(sides.map((side) => [side, rosters.get(debate.teams[side]?.teamId || "") || []]));
    const errors = validateBallotEntry({ ...entry, motionId: undefined }, { ...rules, rosters: sideRosters });
    if (errors.length > 0) {
      setError(errors.join(" "));
      return;
    }
    const result = buildBallotResult(
      entry,
      Object.fromEntries(sides.map((side) => [side, debate.teams[side]?.teamId || ""])),
      debate.adjudicators?.chairId,
      rules
    );
    setSubmitting(true);
    try {
      await postPublicForm(slug, {
        action: "submit",
        kind: "ballot",
        sourceType: "adjudicator",
        sourceId: context.adjudicator.id,
        ...(password !== undefined ? { password } : {}),
        ballot: {
          speakerScores: result.speakerScores,
          teamScores: result.teamScores,
          ...(asksMotion ? { motionId } : {}),
          ...(asksVetoes
            ? { vetoes: Object.fromEntries(Object.entries(vetoes).filter(([, vetoed]) => Boolean(vetoed) && vetoed !== motionId)) }
            : {}),
        },
      });
      onSubmitted(t("publicForms.ballotRecorded", { name: context.adjudicator.name, venue: debate.venueName ?? "" }));
    } catch (caught) {
      if (caught instanceof PublicFormRequestError && caught.passwordRejected) {
        onPasswordRejected(caught.message);
        return;
      }
      setError(caught instanceof Error && caught.message ? caught.message : t("adjPortal.ballot.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const scored = usesSpeakerScores(rules);
  // Poly ranks always come from the totals (Tabbycat's PolyScoresheet).
  const fromScores = scored && (poly || winnerDeclarationFor(rules.preferences) === "none");
  const rankCount = scored && speakerRanksFor(rules.preferences) !== "none"
    ? sides.length * substantiveSpeakerCount(rules)
    : undefined;
  const derived = effectiveRanks(
    Object.fromEntries(sides.map((side) => [side, applyScoreCriteria(entry.speakerScores[side] || [], rules)])),
    entry.ranks,
    rules
  );
  const setRank = (side: DebateSide, rank: number) => setEntry((current) => {
    if (isBP) return { ...current, ranks: { ...current.ranks, [side]: rank } };
    return { ...current, ranks: Object.fromEntries(sides.map((other) => [other, other === side ? rank : rank === 1 ? 2 : 1])) };
  });

  return (
    <Card>
      <CardHeader
        icon={<FileCheck2 aria-hidden="true" />}
        title={t("publicForms.ballotFormTitle", { name: context.adjudicator.name, round: context.round.name })}
        description={debate.venueName ? t("publicForms.ballotFormRoom", { venue: debate.venueName }) : undefined}
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert tone="danger" role="alert">{error}</Alert>}
          {tournament.preferences?.ballotIntroExplanation?.trim() && (
            <Alert tone="info" title={t("results.ballot.instructions")}>
              <span className="whitespace-pre-line text-xs">{tournament.preferences.ballotIntroExplanation}</span>
            </Alert>
          )}
          {!asksMotion && debate.motionText && (
            <p className="rounded-md border border-border bg-background p-2.5 text-[13px] text-fg">{debate.motionText}</p>
          )}
          {chosen && (
            <MotionChoiceFields
              idPrefix="public-ballot"
              motions={roundMotions}
              askMotion={asksMotion}
              askVetoes={asksVetoes}
              sides={sides}
              teamNames={Object.fromEntries(sides.map((side) => [side, debate.teams[side]?.teamName || side]))}
              motionId={motionId}
              vetoes={vetoes}
              onMotionChange={setMotionId}
              onVetoChange={(side, vetoed) => setVetoes((current) => ({ ...current, [side]: vetoed }))}
            />
          )}
          {manualSides && (
            <fieldset className="space-y-2 rounded-md border border-info-border bg-info-subtle p-3">
              <legend className="px-1 text-xs font-semibold text-fg">{t("adjPortal.ballot.sidesLegend")}</legend>
              {!chosen && <p className="text-xs text-fg-muted">{t("adjPortal.ballot.chooseSides")}</p>}
              {[drawn.teams.AFF, drawn.teams.NEG].map((slot) => slot?.teamId && (
                <label key={slot.teamId} className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] font-medium text-fg">
                  <input
                    type="radio"
                    name="public-affirmative-team"
                    checked={chosen && debate.teams.AFF?.teamId === slot.teamId}
                    onChange={() => chooseAffirmative(slot.teamId)}
                    className={cn("h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]", focusRing)}
                  />
                  {t("adjPortal.ballot.affirmativeWas", { team: slot.teamName })}
                </label>
              ))}
            </fieldset>
          )}
          {chosen && sides.map((side) => {
            const slot = debate.teams[side];
            const headingId = `public-ballot-team-${side}`;
            return (
              <section key={side} aria-labelledby={headingId} className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <SideBadge side={side} preferences={rules.preferences} />
                    <h3 id={headingId} className="break-words text-[13px] font-semibold text-fg">
                      {slot?.teamName || t("adjPortal.ballot.unassigned")}
                    </h3>
                  </div>
                  {poly && rules.polyScoresOnly ? null : poly && !scored ? (
                    <label className="flex items-center gap-2 text-xs font-medium text-fg">
                      <input
                        type="checkbox"
                        className={cn("h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]", focusRing)}
                        checked={Boolean(entry.winners?.includes(side))}
                        onChange={(event) => setEntry((current) => ({
                          ...current,
                          winners: event.target.checked
                            ? [...(current.winners || []).filter((item) => item !== side), side]
                            : (current.winners || []).filter((item) => item !== side),
                        }))}
                        aria-label={t("results.ballot.advancesLabel", { team: slot?.teamName || side })}
                      />
                      {t("results.ballot.advances")}
                    </label>
                  ) : fromScores ? (
                    <span className="text-xs font-medium text-fg-muted">
                      {isBP || poly ? `${t("adjPortal.ballot.rank")} ${derived[side] ?? "—"}` : derived[side] === 1 ? t("adjPortal.ballot.win") : t("adjPortal.ballot.loss")}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={`public-ballot-rank-${side}`} className="text-xs text-fg-muted">{t("adjPortal.ballot.rank")}</Label>
                      <Select
                        id={`public-ballot-rank-${side}`}
                        value={entry.ranks?.[side] || 1}
                        aria-describedby={headingId}
                        onChange={(event) => setRank(side, parseInt(event.target.value, 10))}
                        className="h-10 w-auto font-medium"
                      >
                        {isBP ? (
                          <>
                            <option value={1}>{t("adjPortal.ballot.bpFirst")}</option>
                            <option value={2}>{t("adjPortal.ballot.bpSecond")}</option>
                            <option value={3}>{t("adjPortal.ballot.bpThird")}</option>
                            <option value={4}>{t("adjPortal.ballot.bpFourth")}</option>
                          </>
                        ) : (
                          <>
                            <option value={1}>{t("adjPortal.ballot.win")}</option>
                            <option value={2}>{t("adjPortal.ballot.loss")}</option>
                          </>
                        )}
                      </Select>
                    </div>
                  )}
                </div>
                {scored && (
                  <div className="overflow-x-auto">
                    <SpeechRows
                      idPrefix={`public-${side}`}
                      roster={rosters.get(slot?.teamId || "") || []}
                      entries={entry.speakerScores[side] || []}
                      rules={rules}
                      rankCount={rankCount}
                      onChange={(speeches) => setEntry((current) => ({ ...current, speakerScores: { ...current.speakerScores, [side]: speeches } }))}
                    />
                  </div>
                )}
              </section>
            );
          })}
          <p className="text-xs text-fg-muted">{t("publicForms.ballotUnconfirmedNote")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="lg" disabled={submitting} onClick={onCancel}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" size="lg" loading={submitting} loadingText={t("adjPortal.ballot.submitting")}>
              {t("adjPortal.ballot.submit")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Links to the public forms from the public tab, shown only while a form is on. */
export function PublicFormLinks({ slug, ballot, feedback }: { slug: string; ballot: boolean; feedback: boolean }) {
  const { t } = useI18n();
  if (!ballot && !feedback) return null;
  return (
    <nav aria-label={t("publicForms.linksLabel")} className="flex flex-wrap gap-2">
      {ballot && (
        <Link href={`/${slug}/public/ballots`} className={buttonClasses({ variant: "secondary", size: "md" })}>
          {t("publicForms.ballotTitle")}
        </Link>
      )}
      {feedback && (
        <Link href={`/${slug}/public/feedback`} className={buttonClasses({ variant: "secondary", size: "md" })}>
          {t("publicForms.feedbackTitle")}
        </Link>
      )}
    </nav>
  );
}
