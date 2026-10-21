"use client";

import React, { useState } from "react";
import { ListChecks } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { StatusPill } from "@/components/ui/Badge";
import type { MessageKey } from "@/lib/i18n/messages";
import { planBulkScoreUpdate, type BulkScoreError, type BulkScorePlan } from "@/lib/feedback/bulkScores";
import { ADJ_SCORE_MAX, ADJ_SCORE_MIN } from "@/lib/feedback/scores";

const ERROR_KEYS: Record<BulkScoreError, MessageKey> = {
  missingScore: "results.feedback.bulk.errorMissingScore",
  tooManyColumns: "results.feedback.bulk.errorTooManyColumns",
  unknownAdjudicator: "results.feedback.bulk.errorUnknown",
  ambiguousName: "results.feedback.bulk.errorAmbiguous",
  invalidScore: "results.feedback.bulk.errorInvalidScore",
  duplicate: "results.feedback.bulk.errorDuplicate",
};

/**
 * Base scores for many adjudicators at once (Tabbycat adjfeedback-update-scores-bulk): paste
 * `adjudicator,score` lines, check the preview, then save. Staff with adjudicators.scores_edit use
 * it too; their changes reach the cloud through the data-entry sync.
 */
export function BulkScoreUpdate() {
  const { adjudicators, updateAdjudicators } = useTournament();
  const { t, plural, formatDecimal } = useI18n();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<BulkScorePlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const preview = () => {
    setMessage(null);
    setPlan(planBulkScoreUpdate(text, adjudicators));
  };

  const save = async () => {
    if (saving) return;
    // Planned again against the latest records, so a score changed meanwhile is not reverted.
    const fresh = planBulkScoreUpdate(text, adjudicators);
    setPlan(fresh);
    if (fresh.errorCount > 0 || fresh.updates.length === 0) return;
    const byId = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
    setSaving(true);
    setMessage(null);
    try {
      await updateAdjudicators(fresh.updates.map(({ adjudicatorId, baseScore }) => ({ ...byId.get(adjudicatorId)!, baseScore })));
      setMessage({ tone: "success", text: plural("results.feedback.bulk.saved", fresh.updates.length) });
      setPlan(null);
      setText("");
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : t("results.feedback.bulk.saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<ListChecks aria-hidden="true" />}
        title={t("results.feedback.bulk.title")}
        description={t("results.feedback.bulk.description", { min: ADJ_SCORE_MIN, max: ADJ_SCORE_MAX })}
      />
      <CardBody className="space-y-3">
        <Textarea
          label={t("results.feedback.bulk.label")}
          rows={6}
          className="font-mono text-xs"
          placeholder={"Estella Brandybuck,5\nPia Hermansson,4\nLucas Sousa,3.5"}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPlan(null);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={preview} disabled={!text.trim() || saving}>
            {t("results.feedback.bulk.preview")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            loadingText={t("results.feedback.saving")}
            disabled={!plan || plan.errorCount > 0 || plan.updates.length === 0}
          >
            {plan && plan.updates.length > 0
              ? plural("results.feedback.bulk.save", plan.updates.length)
              : t("results.feedback.bulk.saveNone")}
          </Button>
        </div>
        {plan && plan.errorCount > 0 && (
          <Alert tone="danger" role="alert" title={plural("results.feedback.bulk.errors", plan.errorCount)} />
        )}
        {message && <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"} title={message.text} />}
        {plan && plan.rows.length > 0 && (
          <TableContainer>
            <Table>
              <caption className="sr-only">{t("results.feedback.bulk.previewCaption")}</caption>
              <THead>
                <TR>
                  <TH align="right" className="w-12">{t("results.feedback.bulk.colLine")}</TH>
                  <TH>{t("results.feedback.bulk.colAdjudicator")}</TH>
                  <TH align="right">{t("results.feedback.bulk.colCurrent")}</TH>
                  <TH align="right">{t("results.feedback.bulk.colNew")}</TH>
                  <TH>{t("results.feedback.bulk.colStatus")}</TH>
                </TR>
              </THead>
              <TBody>
                {plan.rows.map((row) => (
                  <TR key={row.line}>
                    <TD numeric className="text-fg-muted">{row.line}</TD>
                    <TD className="font-medium">{row.name || "—"}</TD>
                    <TD numeric>{row.previous === undefined ? "—" : formatDecimal(row.previous, 1)}</TD>
                    <TD numeric>{row.score === undefined ? "—" : formatDecimal(row.score, 1)}</TD>
                    <TD>
                      {row.error ? (
                        <StatusPill tone="danger">{t(ERROR_KEYS[row.error])}</StatusPill>
                      ) : row.score === row.previous ? (
                        <StatusPill tone="neutral">{t("results.feedback.bulk.unchanged")}</StatusPill>
                      ) : (
                        <StatusPill tone="success">{t("results.feedback.bulk.change")}</StatusPill>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </CardBody>
    </Card>
  );
}
