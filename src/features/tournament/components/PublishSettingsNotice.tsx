"use client";

import React, { useEffect, useState } from "react";
import { CloudUpload } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { useI18n } from "@/components/i18n/I18nProvider";
import { db } from "@/lib/firebase";
import { planReleaseSync } from "@/features/tournament/application/syncStatus";

type Phase = "idle" | "uploading" | "published" | "failed";

/**
 * Shown after saving tournament settings that public pages, private URLs and other devices read
 * from the published cloud copy (public forms, private-URL ballots, release switches, …). Saving
 * changes this device only; the notice says so and offers the same upload-and-publish step a
 * release uses (`planReleaseSync` + `uploadToCloud`), so a setting never looks live when it is not.
 */
export function PublishSettingsNotice() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { isOwnerOrAdmin, pendingChanges, divergedRecords, uploadIssue, uploadToCloud, cloudSyncMessage } = useTournament();
  const [online, setOnline] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setOnline(navigator.onLine);
  }, []);

  const plan = planReleaseSync({
    cloudConfigured: Boolean(db),
    signedIn: Boolean(user),
    canUpload: isOwnerOrAdmin,
    online,
    pendingTotal: pendingChanges.total,
    divergedCount: divergedRecords.length,
    uploadIssue,
  });

  // A device without cloud sync has nothing to upload: its own public pages already use the setting.
  if (plan.kind === "local-only") return null;

  if (phase === "published") {
    return <Alert tone="success" role="status">{t("setup.publishNotice.published")}</Alert>;
  }

  const publish = async () => {
    setPhase("uploading");
    setError("");
    try {
      const outcome = await uploadToCloud();
      if (outcome.publish === "published" || outcome.publish === "unchanged") {
        setPhase("published");
        return;
      }
      setError(outcome.publishError || t("tabroom.common.release.notUpdated"));
      setPhase("failed");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t("tabroom.common.release.uploadFailed"));
      setPhase("failed");
    }
  };

  return (
    <Alert tone="warning" role="status" title={t("setup.publishNotice.title")}>
      <div className="space-y-2">
        <p>{t("setup.publishNotice.body")}</p>
        {plan.kind === "blocked" && <p role="alert">{plan.reason}</p>}
        {phase === "uploading" && cloudSyncMessage && <p className="text-xs">{cloudSyncMessage}</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <Button
          size="sm"
          variant="secondary"
          disabled={plan.kind === "blocked"}
          loading={phase === "uploading"}
          loadingText={t("tabroom.common.release.uploading")}
          onClick={() => void publish()}
        >
          <CloudUpload aria-hidden="true" />
          {t("setup.shell.uploadAndPublish")}
        </Button>
      </div>
    </Alert>
  );
}
