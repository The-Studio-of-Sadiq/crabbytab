"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { PrintOptionsCard, usePrintTranslator, type PrintTranslator } from "@/features/tournament/components/PrintOptionsCard";
import { returnLocation } from "@/lib/printOptions";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Feedback";
import type { FeedbackQuestion } from "@/types";
import {
  integerScaleChoices,
  isFeedbackEnabledForRound,
  questionsForFeedbackSource,
} from "@/lib/feedback/questions";
import { describeFeedbackPaths, feedbackPathsForRound } from "@/lib/feedback/paths";
import { expectedFeedbackForDebate } from "@/lib/feedback/progress";

type PrintText = PrintTranslator["t"];

const ROLE_KEYS = {
  team: "tabroom.ops.form.roleTeam",
  chair: "role.chair",
  panellist: "role.panellist",
  trainee: "role.trainee",
} as const;

/** Translated counterpart of numericBoundsText (lib/feedback/questions), which returns English. */
function boundsText(question: Pick<FeedbackQuestion, "min" | "max">, t: PrintText): string {
  const hasMin = Number.isFinite(question.min);
  const hasMax = Number.isFinite(question.max);
  if (hasMin && hasMax) return t("tabroom.ops.form.boundsBetween", { min: question.min ?? "", max: question.max ?? "" });
  if (hasMin) return t("tabroom.ops.form.boundsMin", { min: question.min ?? "" });
  if (hasMax) return t("tabroom.ops.form.boundsMax", { max: question.max ?? "" });
  return "";
}

function PrintedAnswer({ question, t }: { question: FeedbackQuestion; t: PrintText }) {
  switch (question.type) {
    case "select_one":
    case "select_many":
      return <p>{question.options?.map((option) => `□ ${option}`).join("     ")}</p>;
    case "yes_no":
      return <p>{t("tabroom.ops.form.yesNo")}</p>;
    case "checkbox":
      return <p>{t("tabroom.ops.form.tickIfTrue")}</p>;
    case "integer_scale":
      return <p>{t("tabroom.ops.form.circleOne", { choices: integerScaleChoices(question).join("   ") })}</p>;
    case "scale":
    case "integer":
    case "float": {
      const bounds = boundsText(question, t);
      const whole = question.type === "integer";
      return (
        <p>
          {bounds
            ? t(whole ? "tabroom.ops.form.wholeNumberBounds" : "tabroom.ops.form.numberBounds", { bounds })
            : t(whole ? "tabroom.ops.form.wholeNumber" : "tabroom.ops.form.number")}
        </p>
      );
    }
    default:
      return <div className={`feedback-print-writing${question.type === "textarea" ? " feedback-print-writing-tall" : ""}`} />;
  }
}

export default function PrintableFeedbackPage() {
  const { tournament, activeRound, debates, teams, adjudicators, saveTournament } = useTournament();
  const { t } = useI18n();
  // The printed forms use the tournament's language; the on-screen controls the viewer's.
  const formText = usePrintTranslator(tournament);
  const pt = formText.t;
  const preferences = tournament?.preferences;
  const paths = feedbackPathsForRound(preferences, activeRound ?? undefined);
  const roundOpen = Boolean(activeRound) && preferences?.feedbackEnabled !== false &&
    isFeedbackEnabledForRound({ postponed: false }, activeRound ?? undefined, preferences?.feedbackInEliminationRounds !== false);
  const roundDebates = activeRound
    ? debates
        .filter((debate) => debate.roundId === activeRound.id && !debate.byeTeamId)
        .sort((left, right) => left.roomRank - right.roomRank)
    : [];
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const adjudicatorMap = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const questionsBySource = {
    team: questionsForFeedbackSource("team", preferences),
    adjudicator: questionsForFeedbackSource("adjudicator", preferences),
  };
  // One form per expected submission, so the printed set matches what the progress tracker expects.
  const forms = roundOpen
    ? roundDebates.flatMap((debate) =>
        expectedFeedbackForDebate(debate, paths).map((item) => ({
          debate,
          item,
          sourceName: item.sourceType === "team"
            ? teamMap.get(item.sourceId)?.name ?? item.sourceId
            : adjudicatorMap.get(item.sourceId)?.name ?? item.sourceId,
          targetName: adjudicatorMap.get(item.targetAdjudicatorId)?.name ?? item.targetAdjudicatorId,
        }))
      )
    : [];
  const teamForms = forms.filter((form) => form.item.sourceType === "team").length;
  const minScore = preferences?.feedbackMinScore ?? 1;
  const maxScore = preferences?.feedbackMaxScore ?? 10;
  const returnTo = returnLocation(preferences?.feedbackReturnLocation);

  return (
    <>
      <main className="screen-only space-y-6">
        <Link
          href={`/${tournament?.slug}/feedback`}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft aria-hidden="true" />
          {t("tabroom.ops.print.backToFeedback")}
        </Link>
        <PageHeader
          title={t("tabroom.ops.print.feedbackTitle")}
          description={
            <>
              <span className="block">
                {t("tabroom.ops.print.feedbackSummary", {
                  round: activeRound?.name ?? t("tabroom.ops.print.noActiveRound"),
                  team: teamForms,
                  adjudicator: forms.length - teamForms,
                })}
              </span>
              <span className="mt-1 block text-xs">
                {t("tabroom.ops.print.feedbackPaths", { paths: describeFeedbackPaths(paths) })}
              </span>
            </>
          }
          actions={
            <Button onClick={() => window.print()} disabled={forms.length === 0}>
              <Printer aria-hidden="true" />
              {t("tabroom.ops.print.printButton")}
            </Button>
          }
        />
        {!activeRound && <Alert tone="warning">{t("tabroom.ops.print.selectRound")}</Alert>}
        {tournament && <PrintOptionsCard tournament={tournament} onSave={saveTournament} kind="feedback" />}
        {activeRound && !roundOpen && <Alert tone="warning">{t("tabroom.ops.print.feedbackNotCollected")}</Alert>}
        {roundOpen && roundDebates.length > 0 && forms.length === 0 && (
          <Alert tone="warning">{t("tabroom.ops.print.allocateFirst")}</Alert>
        )}
      </main>

      <section className="print-only printable-feedback" lang={formText.locale}>
        {forms.map(({ debate, item, sourceName, targetName }) => (
          <article
            className="print-feedback-sheet"
            key={`${debate.id}-${item.sourceType}-${item.sourceId}-${item.targetAdjudicatorId}`}
          >
            <header>
              <h1>{pt("tabroom.ops.form.title", { tournament: tournament?.name ?? "" })}</h1>
              <p>{activeRound?.name} · {debate.venueName || pt("tabroom.ops.sheet.room", { number: debate.roomRank })}</p>
            </header>
            <dl>
              <div><dt>{pt("tabroom.ops.form.from")}</dt><dd>{sourceName} ({pt(ROLE_KEYS[item.sourceRole])})</dd></div>
              <div><dt>{pt("tabroom.ops.form.adjudicator")}</dt><dd>{targetName} ({pt(ROLE_KEYS[item.targetRole])})</dd></div>
            </dl>
            <div className="feedback-print-score">
              <strong>{pt("tabroom.ops.form.overall", { min: minScore, max: maxScore })}</strong>
              <span>
                {pt("tabroom.ops.form.circleOne", {
                  choices: Array.from({ length: maxScore - minScore + 1 }, (_, index) => index + minScore).join("   "),
                })}
              </span>
            </div>
            {questionsBySource[item.sourceType].map((question) => (
              <section key={question.id} className="feedback-print-question">
                <strong>{question.label}{question.required ? " *" : ""}</strong>
                <PrintedAnswer question={question} t={pt} />
              </section>
            ))}
            <section className="feedback-print-question">
              <strong>{pt("tabroom.ops.form.comments")}</strong>
              <div className="feedback-print-writing feedback-print-writing-tall" />
            </section>
            {returnTo && <p><strong>{pt("tabroom.ops.form.returnForm", { place: returnTo })}</strong></p>}
            <p className="feedback-print-confidential">{pt("tabroom.ops.form.confidential")}</p>
          </article>
        ))}
      </section>
    </>
  );
}
