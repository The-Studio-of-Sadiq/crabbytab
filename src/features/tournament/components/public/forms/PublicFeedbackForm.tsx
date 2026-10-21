"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquareHeart, ThumbsDown, ThumbsUp } from "lucide-react";
import type { FeedbackAnswer } from "@/types";
import { defaultFeedbackScore, feedbackScoreStep, validateFeedbackScore } from "@/lib/scoring/validator";
import { questionsForFeedbackSource, validateFeedbackAnswers } from "@/lib/feedback/questions";
import { FeedbackQuestionFields } from "@/components/feedback/FeedbackQuestionFields";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicCenteredCard, PublicShell } from "@/components/public/PublicShell";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Label, Select, Textarea } from "@/components/ui/Field";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import type { PublicFeedbackOption, PublicFormsPerson, PublicFormSourceType } from "@/lib/publicForms";
import {
  postPublicForm,
  PublicFormRequestError,
  usePublicFormsDirectory,
  type PublicFeedbackContext,
} from "./publicFormsClient";
import { PublicFormPasswordField, PublicPersonPicker } from "./PublicFormParts";

const optionKey = (option: PublicFeedbackOption) => `${option.debateId}|${option.targetType}|${option.targetId}`;

/**
 * Tabbycat's public feedback pages (adjfeedback/views.py PublicAddFeedbackIndexView and
 * PublicAddFeedbackByIdUrlView): a team or adjudicator picks themselves, then who they are giving
 * feedback on. Validated like private-URL feedback (docs/public-pages-and-notifications.md).
 */
export function PublicFeedbackFormPage({ slug }: { slug: string }) {
  const { t } = useI18n();
  const { data, error, loading } = usePublicFormsDirectory(slug);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [sourceTab, setSourceTab] = useState<PublicFormSourceType>("team");
  const [context, setContext] = useState<PublicFeedbackContext | null>(null);
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const title = data?.tournament.shortName || data?.tournament.name || t("common.tournament");
  const directory = data?.forms?.feedback;
  const usePassword = data?.forms?.usePassword === true;

  const open = async (sourceType: PublicFormSourceType, person: PublicFormsPerson) => {
    setNotice(null);
    setPasswordError("");
    if (usePassword && !password) {
      setPasswordError(t("publicForms.passwordMissing"));
      return;
    }
    setLoadingFor(person.id);
    try {
      setContext(await postPublicForm<PublicFeedbackContext>(slug, {
        action: "load",
        kind: "feedback",
        sourceType,
        sourceId: person.id,
        ...(usePassword ? { password } : {}),
      }));
    } catch (caught) {
      if (caught instanceof PublicFormRequestError && caught.passwordRejected) {
        setPasswordError(caught.message || t("publicForms.passwordWrong"));
      } else {
        setNotice({ tone: "danger", text: caught instanceof Error && caught.message ? caught.message : t("publicForms.loadFailed") });
      }
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

  const closedMessage = !data ? error || t("publicForms.loadFailed") : !directory ? t("publicForms.feedbackClosed") : null;
  const sourceLists: Record<PublicFormSourceType, PublicFormsPerson[]> = {
    team: directory?.teams ?? [],
    adjudicator: directory?.adjudicators ?? [],
  };

  return (
    <PublicShell title={title} subtitle={t("publicForms.feedbackTitle")} width="narrow" backHref={`/${slug}/public`} backLabel={t("portal.visitPublic")}>
      {notice && <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</Alert>}
      {context ? (
        <PublicFeedbackEntry
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
            icon={<MessageSquareHeart aria-hidden="true" />}
            title={t("publicForms.feedbackPickTitle")}
            description={t("publicForms.feedbackPickDescription")}
          />
          <CardBody className="space-y-4">
            {usePassword && <PublicFormPasswordField value={password} onChange={(value) => { setPassword(value); setPasswordError(""); }} error={passwordError} />}
            <Tabs
              id="public-feedback-source"
              ariaLabel={t("publicForms.sourceTabsLabel")}
              items={[
                { value: "team", label: t("publicForms.fromTeam") },
                { value: "adjudicator", label: t("publicForms.fromAdjudicator") },
              ]}
              value={sourceTab}
              onValueChange={(value) => setSourceTab(value === "adjudicator" ? "adjudicator" : "team")}
            />
            <TabPanel id="public-feedback-source" value={sourceTab}>
              <PublicPersonPicker
                key={sourceTab}
                people={sourceLists[sourceTab]}
                searchLabel={sourceTab === "team" ? t("publicForms.searchTeams") : t("publicForms.searchAdjudicators")}
                actionLabel={(name) => t("publicForms.addFeedbackFrom", { name })}
                detail={(person) => (loadingFor === person.id ? t("publicForms.opening") : undefined)}
                onPick={(person) => void open(sourceTab, person)}
              />
            </TabPanel>
          </CardBody>
        </Card>
      )}
      {!context && data?.forms?.ballot && (
        <p className="text-xs text-fg-muted">
          <Link href={`/${slug}/public/ballots`} className={cn("underline", focusRing)}>{t("publicForms.ballotLink")}</Link>
        </p>
      )}
    </PublicShell>
  );
}

function PublicFeedbackEntry({
  slug,
  context,
  password,
  onCancel,
  onSubmitted,
  onPasswordRejected,
}: {
  slug: string;
  context: PublicFeedbackContext;
  password?: string;
  onCancel: () => void;
  onSubmitted: (message: string) => void;
  onPasswordRejected: (message: string) => void;
}) {
  const { t } = useI18n();
  const preferences = context.tournament.preferences;
  const questions = questionsForFeedbackSource(context.source.type, preferences);
  const minScore = preferences?.feedbackMinScore ?? 1;
  const maxScore = preferences?.feedbackMaxScore ?? 10;
  const [selected, setSelected] = useState(context.options[0] ? optionKey(context.options[0]) : "");
  const [score, setScore] = useState(defaultFeedbackScore(preferences));
  const [agree, setAgree] = useState(true);
  const [comments, setComments] = useState("");
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswer>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const option = context.options.find((candidate) => optionKey(candidate) === selected);
  const targetName = (candidate: PublicFeedbackOption) => candidate.targetName || t("publicForms.anonymous");

  const byRound = useMemo(() => {
    const groups = new Map<string, { name: string; options: PublicFeedbackOption[] }>();
    for (const candidate of context.options) {
      const group = groups.get(candidate.roundId) ?? { name: candidate.roundName, options: [] };
      group.options.push(candidate);
      groups.set(candidate.roundId, group);
    }
    return [...groups.values()];
  }, [context.options]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!option) {
      setError(t("publicForms.pickTarget"));
      return;
    }
    const answersError = validateFeedbackAnswers(questions, answers);
    if (answersError) {
      setError(answersError);
      return;
    }
    const check = validateFeedbackScore(score, preferences);
    if (!check.valid) {
      setError(check.error || t("portal.feedback.failed"));
      return;
    }
    setSubmitting(true);
    try {
      await postPublicForm(slug, {
        action: "submit",
        kind: "feedback",
        sourceType: context.source.type,
        sourceId: context.source.id,
        ...(password !== undefined ? { password } : {}),
        feedback: {
          debateId: option.debateId,
          targetType: option.targetType,
          targetId: option.targetId,
          score,
          ...(option.targetType === "adjudicator" ? { agreeWithDecision: agree } : {}),
          comments: comments.trim(),
          answers,
        },
      });
      onSubmitted(t("portal.feedback.recorded", { target: targetName(option) }));
    } catch (caught) {
      if (caught instanceof PublicFormRequestError && caught.passwordRejected) {
        onPasswordRejected(caught.message);
        return;
      }
      setError(caught instanceof Error && caught.message ? caught.message : t("portal.feedback.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<MessageSquareHeart aria-hidden="true" />}
        title={t("publicForms.feedbackFormTitle", { name: context.source.name || t("publicForms.anonymous") })}
      />
      <CardBody>
        {context.options.length === 0 ? (
          <div className="space-y-3">
            <EmptyState title={t("publicForms.noFeedbackTargets")} />
            <Button variant="secondary" size="lg" onClick={onCancel}>{t("common.cancel")}</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert tone="danger" role="alert">{error}</Alert>}
            {preferences?.feedbackIntroduction?.trim() && (
              <p className="whitespace-pre-line rounded-md border border-border bg-background p-2.5 text-fg-muted">
                {preferences.feedbackIntroduction}
              </p>
            )}
            <Select
              label={t("publicForms.targetLabel")}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {byRound.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.options.map((candidate) => (
                    <option key={optionKey(candidate)} value={optionKey(candidate)}>
                      {candidate.targetType === "team"
                        ? t("publicForms.targetTeam", { name: targetName(candidate) })
                        : t("publicForms.targetAdjudicator", { name: targetName(candidate) })}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="public-feedback-score">{t("portal.feedback.score", { min: minScore, max: maxScore })}</Label>
                <output htmlFor="public-feedback-score" className="text-[13px] font-semibold tabular-nums text-fg">
                  {t("portal.feedback.scoreValue", { score, max: maxScore })}
                </output>
              </div>
              <input
                id="public-feedback-score"
                type="range"
                min={minScore}
                max={maxScore}
                step={feedbackScoreStep(preferences)}
                value={score}
                aria-valuetext={t("portal.feedback.scoreValue", { score, max: maxScore })}
                onChange={(event) => setScore(parseFloat(event.target.value))}
                className={cn("h-8 w-full cursor-pointer rounded-md accent-[rgb(var(--color-accent))]", focusRing)}
              />
            </div>

            {option?.targetType === "adjudicator" && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-xs font-medium text-fg">{t("adjPortal.agreeQuestion")}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={agree === value}
                      onClick={() => setAgree(value)}
                      className={cn(
                        "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors",
                        agree === value
                          ? value ? "border-success-border bg-success-subtle text-fg" : "border-warning-border bg-warning-subtle text-fg"
                          : "border-border-strong bg-surface text-fg-muted hover:bg-muted hover:text-fg",
                        focusRing
                      )}
                    >
                      {value
                        ? <ThumbsUp className="h-4 w-4 text-success" aria-hidden="true" />
                        : <ThumbsDown className="h-4 w-4 text-warning" aria-hidden="true" />}
                      {value ? t("portal.feedback.agreeYes") : t("portal.feedback.agreeNo")}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <Textarea
              id="public-feedback-comments"
              label={
                <>
                  {option?.targetType === "team" ? t("portal.feedback.teamComments") : t("adjPortal.adjudicatorComments")}{" "}
                  <span className="font-normal text-fg-muted">{t("portal.feedback.confidential")}</span>
                </>
              }
              rows={3}
              maxLength={5000}
              value={comments}
              onChange={(event) => setComments(event.target.value)}
            />

            <FeedbackQuestionFields
              questions={questions}
              answers={answers}
              onChange={(questionId, value) => setAnswers((current) => ({ ...current, [questionId]: value }))}
            />

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="lg" disabled={submitting} onClick={onCancel}>{t("common.cancel")}</Button>
              <Button type="submit" variant="primary" size="lg" loading={submitting} loadingText={t("portal.feedback.submitting")}>
                {t("portal.feedback.submit")}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
