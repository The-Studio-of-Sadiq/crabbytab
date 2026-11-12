"use client";

import React from "react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";

/**
 * This private link's saved ballots and feedback the server refused at the last sync. They stay
 * on the device (never silently deleted) until the participant discards them; they no longer
 * stop the portal from syncing.
 */
export function PrivateSyncRejectionsNotice({ privateKey }: { privateKey: string }) {
  const { privateSyncRejections, discardPrivateSyncItems } = useTournament();
  const { t } = useI18n();
  if (privateSyncRejections.length === 0) return null;

  return (
    <Alert tone="warning" role="alert" title={<span className="text-sm">{t("portal.refusedTitle")}</span>}>
      <p>{t("portal.refusedHelp")}</p>
      <ul className="mt-2 space-y-2">
        {privateSyncRejections.map((rejection) => (
          <li
            key={`${rejection.collection}/${rejection.id}`}
            className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
          >
            <span className="min-w-0">
              <strong className="font-semibold">
                {t(rejection.collection === "ballots" ? "portal.refusedBallot" : "portal.refusedFeedback")}
              </strong>
              {": "}
              {rejection.reason}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => discardPrivateSyncItems(privateKey, [rejection])}
            >
              {t("portal.refusedDiscard")}
            </Button>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
