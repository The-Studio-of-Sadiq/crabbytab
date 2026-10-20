"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { createEntityId } from "@/features/tournament/application/entities";
import { ApprovalIncompleteError, approveRegistration } from "@/features/tournament/application/registrationApproval";
import { RegistrationQueue, type QueueActions } from "@/features/tournament/components/registration/RegistrationQueue";
import { RegistrationSettingsForm } from "@/features/tournament/components/registration/RegistrationSettingsForm";
import { RepresentativesPanel } from "@/features/tournament/components/registration/RepresentativesPanel";
import { SlotTransfersPanel } from "@/features/tournament/components/registration/SlotTransfersPanel";
import {
  createRegistrationClient,
  type RegistrationOverview,
} from "@/features/tournament/components/registration/registrationClient";
import type { RegistrationSubmission } from "@/lib/registration/types";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabPanel, Tabs } from "@/components/ui/Tabs";

type View = "queue" | "settings" | "representatives";

/** Default starting score for registered adjudicators, as for adjudicators added by hand. */
const REGISTERED_ADJUDICATOR_BASE_SCORE = 5;

export default function RegistrationAdminPage() {
  const { t, formatList } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const {
    tournament,
    loading,
    isOwnerOrAdmin,
    teams,
    adjudicators,
    institutions,
    addInstitutions,
    addTeams,
    addAdjudicators,
    liveSync,
  } = useTournament();
  const [view, setView] = useState<View>("queue");
  const [overview, setOverview] = useState<RegistrationOverview | null>(null);
  // null: no error; "" : failed without a message (the translated fallback is shown).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const cloudTournament = Number(tournament?.syncVersion) > 0;
  const client = useMemo(
    () => (user && tournament ? createRegistrationClient(user, tournament.id) : null),
    [user, tournament]
  );

  const reload = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      setOverview(await client.load());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "");
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    if (client && isOwnerOrAdmin && cloudTournament) void reload();
  }, [client, isOwnerOrAdmin, cloudTournament, reload]);

  const replaceSubmission = (submission: RegistrationSubmission) =>
    setOverview((current) =>
      current
        ? { ...current, submissions: current.submissions.map((item) => (item.id === submission.id ? submission : item)) }
        : current
    );

  // Approval writes the new team or adjudicator through the live path; without it the record
  // would only reach other devices with the next upload.
  const approveBlocked =
    liveSync.mode === "off"
      ? t("setup.registration.approveBlockedOff")
      : liveSync.mode === "error"
        ? t("setup.registration.approveBlockedError")
        : null;

  const actions: QueueActions | null = client
    ? {
        approve: async (submission) => {
          setNotice("");
          try {
            const result = await approveRegistration(submission, {
              api: {
                claim: (item) => client.review("claim", item),
                release: (item) => client.review("release", item),
                approve: (item, entity) => client.review("approve", item, { entityId: entity.id, entityName: entity.name }),
              },
              institutions,
              teams,
              addInstitutions,
              addTeams,
              addAdjudicators,
              createId: createEntityId,
              adjudicatorBaseScore: REGISTERED_ADJUDICATOR_BASE_SCORE,
              settings: overview?.settings,
            });
            replaceSubmission(result.submission);
            const notes = [
              t(result.entity.kind === "team" ? "setup.registration.addedAsTeam" : "setup.registration.addedAsAdjudicator", {
                name: result.entity.name,
              }),
            ];
            if (result.createdInstitution) {
              notes.push(t("setup.registration.institutionCreated", { name: result.createdInstitution.name }));
            }
            if (result.unmatchedConflicts.length > 0) {
              notes.push(t("setup.registration.unmatchedConflicts", { list: formatList(result.unmatchedConflicts) }));
            }
            setNotice(notes.join(" "));
          } catch (error) {
            if (error instanceof ApprovalIncompleteError) replaceSubmission(error.submission);
            else await reload();
            throw error;
          }
        },
        allocate: async (submission, teams, adjudicators) => {
          setNotice("");
          const result = await client.allocate(submission, teams, adjudicators);
          replaceSubmission(result.submission);
          const institution = submission.institution?.name ?? t("setup.registration.theInstitution");
          setNotice(
            result.link?.delivered
              ? t("setup.registration.allocatedLinkSent", { institution, email: result.link.email })
              : t("setup.registration.allocatedLinkFailed", {
                  institution,
                  error: result.link?.error ?? t("setup.registration.unknownError"),
                  link: result.link?.link ?? "",
                })
          );
          await reload();
        },
        review: async (action, submission, extra) => replaceSubmission(await client.review(action, submission, extra)),
        markApproved: async (submission, entity) =>
          replaceSubmission(await client.review("approve", submission, { entityId: entity.id, entityName: entity.name })),
      }
    : null;

  if (authLoading || loading) return <p className="p-6 text-sm text-fg-muted" role="status">{t("setup.registration.loading")}</p>;
  if (!user || !tournament || !isOwnerOrAdmin) {
    return <Alert tone="danger" role="alert" className="m-6">{t("setup.registration.signInRequired")}</Alert>;
  }

  const publicLink = overview?.slug && typeof window !== "undefined" ? `${window.location.origin}/register/${overview.slug}` : "";
  const openCount = overview?.submissions.filter((item) => item.status === "pending" || item.status === "approving").length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("setup.registration.title")}
        description={t("setup.registration.description")}
        actions={
          cloudTournament && (
            <Button onClick={() => void reload()} loading={refreshing}>{t("setup.common.refresh")}</Button>
          )
        }
      />
      {!cloudTournament ? (
        <Alert tone="info" title={t("setup.registration.needsCloudTitle")}>
          {t("setup.registration.needsCloudBody")}
        </Alert>
      ) : (
        <>
          {loadError !== null && <Alert tone="danger" role="alert">{loadError || t("setup.registration.loadFailed")}</Alert>}
          {notice && <Alert tone="success" role="status">{notice}</Alert>}
          {overview && client && actions && (
            <>
              <Tabs
                id="registration-view"
                ariaLabel={t("setup.registration.sectionsLabel")}
                value={view}
                onValueChange={setView}
                items={[
                  { value: "queue", label: t("setup.registration.tabQueue"), count: openCount },
                  { value: "settings", label: t("setup.registration.tabSettings") },
                  { value: "representatives", label: t("setup.registration.tabRepresentatives"), count: overview.representatives.length },
                ]}
              />
              <TabPanel id="registration-view" value={view}>
                {view === "queue" && (
                  <>
                    {!overview.configured && (
                      <Alert tone="info" className="mb-3">{t("setup.registration.notConfigured")}</Alert>
                    )}
                    <RegistrationQueue
                      submissions={overview.submissions}
                      settings={overview.settings}
                      teams={teams}
                      adjudicators={adjudicators}
                      currentUid={user.uid}
                      approveBlocked={approveBlocked}
                      actions={actions}
                    />
                  </>
                )}
                {view === "settings" && (
                  <RegistrationSettingsForm
                    key={overview.settings.updatedAt ?? "initial"}
                    initial={overview.settings}
                    publicLink={publicLink}
                    onSave={async (settings) => {
                      const saved = await client.saveSettings(settings);
                      setOverview((current) => (current ? { ...current, settings: saved.settings, configured: true } : current));
                    }}
                  />
                )}
                {view === "representatives" && (
                  <RepresentativesPanel
                    client={client}
                    representatives={overview.representatives}
                    counters={overview.counters}
                    onChange={(representatives) => setOverview((current) => (current ? { ...current, representatives } : current))}
                  />
                )}
                {view === "representatives" && overview.settings.slotTransfers && (
                  <div className="mt-4">
                    <SlotTransfersPanel client={client} transfers={overview.transfers ?? []} onReviewed={reload} />
                  </div>
                )}
              </TabPanel>
            </>
          )}
        </>
      )}
    </div>
  );
}
