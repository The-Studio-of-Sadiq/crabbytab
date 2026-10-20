"use client";

import React, { useState } from "react";
import { FileJson } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { downloadTextFile } from "@/lib/csv/download";
import { RULES_PRESETS, getRulesPreset } from "@/lib/setup/presets";
import {
  buildConfigFile,
  parseConfigFile,
  planConfigApply,
  planPresetApply,
  type ConfigPlan,
} from "@/lib/setup/configTransfer";
import type { Tournament, TournamentPreferences } from "@/types";

function show(value: unknown): string {
  if (value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * Settings-only configuration file (export, and import with a preview) and applying a rules
 * preset to this tournament with a preview (docs/data-import-export.md). Nothing is saved until
 * the organiser confirms the previewed changes; saveTournament enforces the settings guards again.
 */
export function ConfigTransferCard({
  tournament,
  preferences,
  lockedFields,
  hasDebates,
  onSave,
}: {
  tournament: Tournament;
  preferences: TournamentPreferences;
  lockedFields: readonly string[];
  hasDebates: boolean;
  onSave: (tournament: Tournament) => Promise<void>;
}) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<{ plan: ConfigPlan; source: string; skipped: string[] } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [presetId, setPresetId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const current = { format: tournament.format, preferences };
  const context = { lockedFields, hasDebates };

  const exportFile = () => {
    const file = buildConfigFile({ ...tournament, preferences });
    downloadTextFile(`${tournament.slug || "tournament"}-config.json`, `${JSON.stringify(file, null, 2)}\n`, "application/json");
  };

  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target.files?.[0];
    event.target.value = "";
    setStatus("");
    if (!input) return;
    let text: string;
    try {
      text = await input.text();
    } catch {
      setErrors([t("setup.config.transfer.readError")]);
      return;
    }
    const parsed = parseConfigFile(text);
    if (!parsed.ok) {
      setPlan(null);
      setErrors(parsed.errors);
      return;
    }
    setErrors([]);
    setPlan({
      plan: planConfigApply(current, parsed.file, context),
      source: parsed.file.source.name || input.name,
      skipped: parsed.skipped.map((item) => item.key),
    });
  };

  const previewPreset = () => {
    const preset = getRulesPreset(presetId);
    if (!preset) return;
    setErrors([]);
    setStatus("");
    setPlan({ plan: planPresetApply(current, preset, context), source: preset.label, skipped: [] });
  };

  const apply = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await onSave({
        ...tournament,
        format: plan.plan.next.format,
        preferences: plan.plan.next.preferences,
        updatedAt: new Date().toISOString(),
      });
      setStatus(t("setup.config.transfer.applied", { count: plan.plan.changes.length }));
      setPlan(null);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : t("setup.config.transfer.applyError")]);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<FileJson aria-hidden="true" />}
        title={t("setup.config.transfer.title")}
        description={t("setup.config.transfer.description")}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="secondary" onClick={exportFile}>{t("setup.config.transfer.export")}</Button>
          <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-fg focus-within:ring-2 focus-within:ring-accent">
            {t("setup.config.transfer.import")}
            <input type="file" accept=".json,application/json" className="sr-only" onChange={(event) => void readFile(event)} />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t("setup.config.transfer.presetLabel")}
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            wrapperClassName="min-w-[16rem]"
          >
            <option value="">{t("setup.config.transfer.presetChoose")}</option>
            {RULES_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!presetId} onClick={previewPreset}>
            {t("setup.config.transfer.presetPreview")}
          </Button>
        </div>

        {errors.length > 0 && (
          <Alert role="alert" tone="danger">
            <ul className="list-disc ps-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </Alert>
        )}
        <p role="status" className="text-xs text-fg-muted">{status}</p>

        {plan && (
          <section aria-label={t("setup.config.transfer.previewLabel")} className="space-y-3">
            <h3 className="text-[13px] font-semibold text-fg">
              {t("setup.config.transfer.previewTitle", { source: plan.source, count: plan.plan.changes.length })}
            </h3>
            {plan.plan.changes.length === 0 ? (
              <p className="text-[13px] text-fg-muted">{t("setup.config.transfer.noChanges")}</p>
            ) : (
              <TableContainer>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t("setup.config.transfer.colSetting")}</TH>
                      <TH>{t("setup.config.transfer.colCurrent")}</TH>
                      <TH>{t("setup.config.transfer.colNew")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {plan.plan.changes.map((change) => (
                      <TR key={change.key}>
                        <TD><code className="text-xs">{change.key}</code></TD>
                        <TD className="text-fg-muted">{show(change.from)}</TD>
                        <TD>{show(change.to)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            )}
            {plan.plan.blocked.length > 0 && (
              <Alert tone="warning">
                <p>{t("setup.config.transfer.blockedIntro")}</p>
                <ul className="list-disc ps-4">
                  {plan.plan.blocked.map((item) => (
                    <li key={item.key}>
                      <code>{item.key}</code>:{" "}
                      {t(item.reason === "locked_by_ballots" ? "setup.config.transfer.blockedBallots" : "setup.config.transfer.blockedDraw")}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {plan.skipped.length > 0 && (
              <p className="text-xs text-fg-muted">
                {t("setup.config.transfer.skipped", { keys: plan.skipped.join(", ") })}
              </p>
            )}
            {plan.plan.errors.length > 0 && (
              <Alert role="alert" tone="danger">
                <ul className="list-disc ps-4">{plan.plan.errors.map((error) => <li key={error}>{error}</li>)}</ul>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={plan.plan.changes.length === 0 || plan.plan.errors.length > 0}
                onClick={() => setConfirming(true)}
              >
                {t("setup.config.transfer.apply")}
              </Button>
              <Button variant="secondary" onClick={() => setPlan(null)}>{t("setup.config.transfer.discard")}</Button>
            </div>
          </section>
        )}
      </CardBody>
      {confirming && plan && (
        <ConfirmActionDialog
          title={t("setup.config.transfer.confirmTitle")}
          description={t("setup.config.transfer.confirmDescription", { count: plan.plan.changes.length })}
          confirmLabel={t("setup.config.transfer.apply")}
          isBusy={saving}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void apply()}
        />
      )}
    </Card>
  );
}
