"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  const [loadError, setLoadError] = useState("");
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
    setLoadError("");
    try {
      setOverview(await client.load());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load registration.");
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
      ? "Approving needs live updates on this device (see the cloud status menu). Records created otherwise would reach other devices only with the next upload."
      : liveSync.mode === "error"
        ? "Live updates stopped on this device. Fix the cloud status before approving."
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
            const notes = [`${result.entity.name} added as ${result.entity.kind === "team" ? "a team" : "an adjudicator"}.`];
            if (result.createdInstitution) {
              notes.push(`New institution ${result.createdInstitution.name} was created on this device; upload to share it with other devices.`);
            }
            if (result.unmatchedConflicts.length > 0) {
              notes.push(`Declared conflicts not found in the tournament (add them by hand if needed): ${result.unmatchedConflicts.join(", ")}.`);
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
          setNotice(
            result.link?.delivered
              ? `${submission.institution?.name ?? "The institution"} has its places; ${result.link.email} received their representative link.`
              : `${submission.institution?.name ?? "The institution"} has its places, but the link email failed (${result.link?.error ?? "unknown error"}). Share it by hand: ${result.link?.link ?? ""}`
          );
          await reload();
        },
        review: async (action, submission, extra) => replaceSubmission(await client.review(action, submission, extra)),
        markApproved: async (submission, entity) =>
          replaceSubmission(await client.review("approve", submission, { entityId: entity.id, entityName: entity.name })),
      }
    : null;

  if (authLoading || loading) return <p className="p-6 text-sm text-fg-muted" role="status">Loading registration…</p>;
  if (!user || !tournament || !isOwnerOrAdmin) {
    return <Alert tone="danger" role="alert" className="m-6">Sign in as a tournament administrator to manage registration.</Alert>;
  }

  const publicLink = overview?.slug && typeof window !== "undefined" ? `${window.location.origin}/register/${overview.slug}` : "";
  const openCount = overview?.submissions.filter((item) => item.status === "pending" || item.status === "approving").length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Registration"
        description="Teams, adjudicators and institution representatives register on a public form. Submissions wait here until an administrator approves them."
        actions={
          cloudTournament && (
            <Button onClick={() => void reload()} loading={refreshing}>Refresh</Button>
          )
        }
      />
      {!cloudTournament ? (
        <Alert tone="info" title="Registration needs a cloud copy">
          This tournament is only stored on this device. Registrations are received by the server, so upload the tournament
          (cloud status menu → Upload now) before opening registration. Approved entries are then added live for every
          administrator device.
        </Alert>
      ) : (
        <>
          {loadError && <Alert tone="danger" role="alert">{loadError}</Alert>}
          {notice && <Alert tone="success" role="status">{notice}</Alert>}
          {overview && client && actions && (
            <>
              <Tabs
                id="registration-view"
                ariaLabel="Registration sections"
                value={view}
                onValueChange={setView}
                items={[
                  { value: "queue", label: "Review queue", count: openCount },
                  { value: "settings", label: "Settings" },
                  { value: "representatives", label: "Representatives", count: overview.representatives.length },
                ]}
              />
              <TabPanel id="registration-view" value={view}>
                {view === "queue" && (
                  <>
                    {!overview.configured && (
                      <Alert tone="info" className="mb-3">Registration is not set up yet. Open the Settings tab to configure and open it.</Alert>
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
