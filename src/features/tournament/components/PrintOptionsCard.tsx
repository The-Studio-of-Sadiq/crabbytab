"use client";

import React, { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import type { Tournament } from "@/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { useI18n, type RichTags } from "@/components/i18n/I18nProvider";
import {
  createTranslator,
  getLocaleDefinition,
  lookupMessage,
  matchLocale,
  richSegments,
  type Locale,
  type MessageKey,
  type MessageValues,
  type Translator,
} from "@/lib/i18n";

export { returnLocation } from "@/lib/printOptions";

export interface PrintTranslator extends Translator {
  rich: (key: MessageKey, tags: RichTags, values?: MessageValues) => React.ReactNode;
}

/**
 * Translator for printed sheets: they go to participants, so they use the tournament's public
 * language rather than the tab director's UI language (falling back to the viewer's language).
 */
export function usePrintTranslator(tournament: Pick<Tournament, "preferences"> | null | undefined): PrintTranslator {
  const { locale: viewerLocale } = useI18n();
  const locale: Locale = matchLocale(tournament?.preferences?.publicLanguage) ?? viewerLocale;
  return useMemo(() => {
    const translator = createTranslator(locale);
    return {
      ...translator,
      rich: (key, tags, values) =>
        richSegments(locale, lookupMessage(locale, key), values).map((segment, index) => {
          if (typeof segment === "string") return <React.Fragment key={index}>{segment}</React.Fragment>;
          const render = tags[segment.tag];
          return <React.Fragment key={index}>{render ? render(segment.text) : segment.text}</React.Fragment>;
        }),
    };
  }, [locale]);
}

/**
 * Printed-form options (Tabbycat score_return_location, feedback_return_location,
 * ballots_confirm_digits, ballots_hide_motions), saved in the tournament's preferences.
 */
export function PrintOptionsCard({
  tournament,
  onSave,
  kind,
}: {
  tournament: Tournament;
  onSave: (tournament: Tournament) => Promise<void>;
  kind: "ballots" | "feedback";
}) {
  const { t } = useI18n();
  const printLocale = usePrintTranslator(tournament).locale;
  const preferences = tournament.preferences;
  const [returnTo, setReturnTo] = useState(
    (kind === "ballots" ? preferences.ballotReturnLocation : preferences.feedbackReturnLocation) ?? ""
  );
  const [digits, setDigits] = useState(preferences.ballotsConfirmDigits === true);
  const [hideMotions, setHideMotions] = useState(preferences.ballotsHideMotions === true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await onSave({
        ...tournament,
        preferences: {
          ...preferences,
          ...(kind === "ballots"
            ? { ballotReturnLocation: returnTo.trim(), ballotsConfirmDigits: digits, ballotsHideMotions: hideMotions }
            : { feedbackReturnLocation: returnTo.trim() }),
        },
      });
      setSaved(true);
    } catch (cause) {
      setError(t("tabroom.ops.printOptions.saveFailed", { message: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<Printer aria-hidden="true" />}
        title={t("tabroom.ops.printOptions.title")}
        description={t("tabroom.ops.printOptions.printLanguage", { language: getLocaleDefinition(printLocale).nativeName })}
      />
      <CardBody className="space-y-3">
        <Input
          label={kind === "ballots" ? t("tabroom.ops.printOptions.returnBallots") : t("tabroom.ops.printOptions.returnFeedback")}
          help={t("tabroom.ops.printOptions.returnHelp")}
          maxLength={120}
          value={returnTo}
          onChange={(event) => setReturnTo(event.target.value)}
          wrapperClassName="max-w-md"
        />
        {kind === "ballots" && (
          <>
            <Checkbox
              label={t("tabroom.ops.printOptions.confirmDigits")}
              description={t("tabroom.ops.printOptions.confirmDigitsHelp")}
              checked={digits}
              onChange={(event) => setDigits(event.target.checked)}
            />
            <Checkbox
              label={t("tabroom.ops.printOptions.hideMotions")}
              description={t("tabroom.ops.printOptions.hideMotionsHelp")}
              checked={hideMotions}
              onChange={(event) => setHideMotions(event.target.checked)}
            />
          </>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" loading={saving} loadingText={t("tabroom.common.saving")} onClick={() => void save()}>
            {t("tabroom.ops.printOptions.save")}
          </Button>
          {saved && <span role="status" className="text-xs text-fg-muted">{t("tabroom.ops.printOptions.saved")}</span>}
        </div>
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
      </CardBody>
    </Card>
  );
}
