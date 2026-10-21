"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Mail, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { AutomaticNotificationsPanel } from "@/features/tournament/components/AutomaticNotificationsPanel";
import { EmailSettingsPanel } from "@/features/tournament/components/EmailSettingsPanel";
import {
  EMAIL_RECIPIENT_GROUPS,
  findCredentialEmailConflict,
  renderEmailTemplate,
  resolveEmailRecipients,
  institutionCoachRecipients,
  usesPrivateCredentials,
  MAX_CAMPAIGN_RECIPIENTS,
} from "@/lib/email/messaging";
import type {
  EmailCampaignResult,
  EmailRecipientGroup,
  StoredEmailCampaign,
} from "@/lib/email/messaging";
import type { MessageKey } from "@/lib/i18n/messages";

const RECIPIENT_GROUP_LABELS: Record<EmailRecipientGroup, MessageKey> = {
  all_teams: "setup.email.groupAllTeams",
  breaking_teams: "setup.email.groupBreakingTeams",
  non_breaking_teams: "setup.email.groupNonBreakingTeams",
  all_adjudicators: "setup.email.groupAllAdjudicators",
  checked_in_adjudicators: "setup.email.groupCheckedInAdjudicators",
  trainees: "setup.email.groupTrainees",
  all_participants: "setup.email.groupAllParticipants",
  round_participants: "setup.email.groupRoundParticipants",
  round_adjudicators: "setup.email.groupRoundAdjudicators",
  chairs: "setup.email.groupChairs",
  panellists: "setup.email.groupPanellists",
  institution_coaches: "setup.email.groupInstitutionCoaches",
};

const ROUND_RECIPIENT_GROUPS: EmailRecipientGroup[] = [
  "round_participants",
  "round_adjudicators",
  "chairs",
  "panellists",
];

/** Subjects and bodies are sent as written (emails are English-only); only the labels are translated. */
const EMAIL_TEMPLATES = {
  announcement: {
    label: "setup.email.templateAnnouncement",
    subject: "{{tournament}} announcement",
    body: "Hi {{name}},\n\nAn update from {{tournament}}.\n\nBest,\nTournament Staff",
  },
  round_details: {
    label: "setup.email.templateRoundDetails",
    subject: "{{tournament}} — {{round}} details",
    body: "Hi {{name}},\n\nYour details for {{round}}:\n{{debate}}\nVenue: {{venue}}\nChair: {{chair}}\n\nBest,\nTournament Staff",
  },
  adjudicator_assignment: {
    label: "setup.email.templateAdjudicatorAssignment",
    subject: "{{tournament}} — {{round}} adjudicator assignment",
    body: "Hi {{name}},\n\nYou are assigned to {{debate}} in {{round}}.\nVenue: {{venue}}\nChair: {{chair}}\nPanellists: {{panellists}}\n\nBest,\nTournament Staff",
  },
  feedback_reminder: {
    label: "setup.email.templateFeedbackReminder",
    subject: "{{tournament}} — please submit feedback",
    body: "Hi {{name}},\n\nPlease remember to submit feedback for {{round}}.\n\nBest,\nTournament Staff",
  },
  adjudicator_private_portal: {
    label: "setup.email.templateAdjudicatorPrivatePortal",
    subject: "{{tournament}} — your private adjudicator portal",
    body: "Hi {{name}},\n\nUse your personal link and passcode to access your adjudicator portal for {{tournament}}.\n\nPrivate link: {{private_url}}\nPasscode: {{passcode}}\n\nPlease keep these details private and do not forward this email.\n\nBest,\nTournament Staff",
  },
  team_private_portal: {
    label: "setup.email.templateTeamPrivatePortal",
    subject: "{{tournament}} — your team's private portal",
    body: "Hi {{name}},\n\nUse your team's link and passcode to see your draw, check in and submit feedback for {{tournament}}.\n\nTeam: {{team}}\nPrivate link: {{private_url}}\nPasscode: {{passcode}}\n\nPlease share these details only with your teammates.\n\nBest,\nTournament Staff",
  },
} as const satisfies Record<string, { label: MessageKey; subject: string; body: string }>;

const SMTP_VARIABLES: { name: string; note?: MessageKey }[] = [
  { name: "SMTP_HOST" },
  { name: "SMTP_PORT", note: "setup.email.smtpPortNote" },
  { name: "SMTP_SECURE", note: "setup.email.smtpSecureNote" },
  { name: "SMTP_USER" },
  { name: "SMTP_PASS" },
  { name: "SMTP_FROM" },
  { name: "FIREBASE_SERVICE_ACCOUNT_JSON", note: "setup.email.smtpServiceAccountNote" },
];

export default function EmailSettingsPage() {
  const {
    tournament,
    isOwnerOrAdmin,
    rounds,
    teams,
    adjudicators,
    debates,
    venues,
    breakCategories,
    institutions,
  } = useTournament();
  const { user } = useAuth();
  const { t, plural, formatDateTime, formatList } = useI18n();
  const [testSending, setTestSending] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testError, setTestError] = useState("");
  const [recipientGroup, setRecipientGroup] = useState<EmailRecipientGroup>("all_adjudicators");
  const [roundId, setRoundId] = useState("");
  const [templateId, setTemplateId] = useState<keyof typeof EMAIL_TEMPLATES | "custom">("announcement");
  const [subject, setSubject] = useState<string>(EMAIL_TEMPLATES.announcement.subject);
  const [body, setBody] = useState<string>(EMAIL_TEMPLATES.announcement.body);
  const [confirmedSend, setConfirmedSend] = useState(false);
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [campaignResult, setCampaignResult] = useState<EmailCampaignResult | null>(null);
  const [campaignError, setCampaignError] = useState("");
  const [campaignHistory, setCampaignHistory] = useState<StoredEmailCampaign[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // null: no error. "": failed without a server message (the translated fallback is shown).
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retryingCampaignId, setRetryingCampaignId] = useState("");

  const refreshCampaignHistory = useCallback(async () => {
    if (!tournament || !user || !isOwnerOrAdmin) return;

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/email/history?tournamentId=${encodeURIComponent(tournament.id)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "");
      setCampaignHistory(result.campaigns as StoredEmailCampaign[]);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "");
    } finally {
      setHistoryLoading(false);
    }
  }, [tournament, user, isOwnerOrAdmin]);

  useEffect(() => {
    void refreshCampaignHistory();
  }, [refreshCampaignHistory]);

  const selectedRound = rounds.find((round) => round.id === roundId);
  const includesPrivateCredentials = usesPrivateCredentials(subject, body);
  const requiresRound = ROUND_RECIPIENT_GROUPS.includes(recipientGroup);
  const recipients = useMemo(
    () =>
      resolveEmailRecipients(
        recipientGroup,
        teams,
        adjudicators,
        debates,
        rounds.find((round) => round.id === roundId),
        {
          includePrivateCredentials: includesPrivateCredentials,
          privateUrlOrigin: typeof window === "undefined" ? undefined : window.location.origin,
          tournamentSlug: tournament?.slug,
          preserveDuplicateEmails: includesPrivateCredentials,
          venues,
          breakCategories,
          coaches: institutionCoachRecipients(institutions),
        }
      ),
    [
      recipientGroup,
      teams,
      adjudicators,
      debates,
      rounds,
      roundId,
      includesPrivateCredentials,
      tournament?.slug,
      venues,
      breakCategories,
      institutions,
    ]
  );

  const credentialConflict = includesPrivateCredentials ? findCredentialEmailConflict(recipients) : null;
  let preview: { subject: string; body: string } | null = null;
  let previewError = "";
  if (recipients[0] && tournament) {
    try {
      preview = {
        subject: renderEmailTemplate(subject, recipients[0], tournament.name, selectedRound?.name),
        body: renderEmailTemplate(body, recipients[0], tournament.name, selectedRound?.name),
      };
    } catch (cause) {
      // Messages thrown by the template renderer are shown as written.
      previewError = cause instanceof Error ? cause.message : t("setup.email.invalidTemplateVariable");
    }
  }

  const sendTestEmail = async () => {
    if (!tournament || !user || !testRecipient.trim()) return;

    setTestSending(true);
    setTestMessage("");
    setTestError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/email/test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tournamentId: tournament.id, recipientEmail: testRecipient.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("setup.email.testFailed"));
      setTestMessage(result.message);
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : t("setup.email.testFailed"));
    } finally {
      setTestSending(false);
    }
  };

  const sendCampaign = async () => {
    if (!tournament || !user || !confirmedSend || recipients.length === 0) return;

    setSendingCampaign(true);
    setCampaignResult(null);
    setCampaignError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tournamentId: tournament.id,
          recipientGroup,
          roundId: roundId || undefined,
          subject,
          body,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("setup.email.sendFailed"));
      setCampaignResult(result as EmailCampaignResult);
      setConfirmedSend(false);
      await refreshCampaignHistory();
    } catch (cause) {
      setCampaignError(cause instanceof Error ? cause.message : t("setup.email.sendFailed"));
    } finally {
      setSendingCampaign(false);
    }
  };

  const retryFailed = async (campaignId: string) => {
    if (!tournament || !user) return;

    setRetryingCampaignId(campaignId);
    setCampaignResult(null);
    setCampaignError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/email/retry", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tournamentId: tournament.id, campaignId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("setup.email.retryError"));
      setCampaignResult(result as EmailCampaignResult);
      await refreshCampaignHistory();
    } catch (cause) {
      setCampaignError(cause instanceof Error ? cause.message : t("setup.email.retryError"));
      await refreshCampaignHistory();
    } finally {
      setRetryingCampaignId("");
    }
  };

  const clearCampaignResult = () => {
    setCampaignResult(null);
    setCampaignError("");
    setConfirmedSend(false);
  };

  if (!isOwnerOrAdmin) {
    return (
      <Alert tone="warning" role="status">
        {t("setup.email.adminOnly")}
      </Alert>
    );
  }

  const overLimit = recipients.length > MAX_CAMPAIGN_RECIPIENTS;
  const canConfirm = recipients.length > 0 && !overLimit && (!requiresRound || Boolean(roundId));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
            {t("setup.email.title")}
          </span>
        }
        description={t("setup.email.description")}
      />

      <Card>
        <CardHeader icon={<ShieldCheck aria-hidden="true" />} title={t("setup.email.smtpTitle")} />
        <CardBody className="space-y-4">
          <p className="text-[13px] text-fg-muted">{t("setup.email.smtpIntro")}</p>
          <ul
            aria-label={t("setup.email.smtpEnvLabel")}
            className="space-y-0.5 rounded-md border border-border bg-muted p-3 font-mono text-xs text-fg"
          >
            {SMTP_VARIABLES.map((variable) => (
              <li key={variable.name}>
                {variable.name}
                {variable.note && <span className="text-fg-muted"> ({t(variable.note)})</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">{t("setup.email.smtpHelp")}</p>
          <Input
            label={t("setup.email.testRecipientLabel")}
            type="email"
            required
            value={testRecipient}
            onChange={(event) => setTestRecipient(event.target.value)}
            placeholder={user?.email || "name@example.com"}
            wrapperClassName="max-w-md"
          />
          <Button
            variant="primary"
            onClick={sendTestEmail}
            disabled={!testRecipient.trim()}
            loading={testSending}
            loadingText={t("setup.email.sendingTest")}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {t("setup.email.sendTest")}
          </Button>
          {testMessage && <Alert tone="success" role="status">{testMessage}</Alert>}
          {testError && <Alert tone="danger" role="alert">{testError}</Alert>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Send aria-hidden="true" />}
          title={t("setup.email.composeTitle")}
          description={t("setup.email.composeDescription", { limit: MAX_CAMPAIGN_RECIPIENTS })}
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("setup.email.recipientsLabel")}
              value={recipientGroup}
              onChange={(event) => {
                setRecipientGroup(event.target.value as EmailRecipientGroup);
                clearCampaignResult();
              }}
            >
              {EMAIL_RECIPIENT_GROUPS.map((group) => (
                <option key={group} value={group}>{t(RECIPIENT_GROUP_LABELS[group])}</option>
              ))}
            </Select>
            <Select
              label={t("setup.email.roundLabel")}
              value={roundId}
              onChange={(event) => {
                setRoundId(event.target.value);
                clearCampaignResult();
              }}
            >
              <option value="">{t("setup.email.noRound")}</option>
              {rounds.filter((round) => !round.cancelled).map((round) => (
                <option key={round.id} value={round.id}>{round.name}</option>
              ))}
            </Select>
            <Select
              label={t("setup.email.templateLabel")}
              wrapperClassName="sm:col-span-2"
              value={templateId}
              onChange={(event) => {
                const nextId = event.target.value as keyof typeof EMAIL_TEMPLATES | "custom";
                setTemplateId(nextId);
                if (nextId !== "custom") {
                  setSubject(EMAIL_TEMPLATES[nextId].subject);
                  setBody(EMAIL_TEMPLATES[nextId].body);
                  if (nextId === "adjudicator_private_portal") {
                    setRecipientGroup("all_adjudicators");
                  }
                  if (nextId === "team_private_portal") {
                    setRecipientGroup("all_teams");
                  }
                }
                clearCampaignResult();
              }}
            >
              {Object.entries(EMAIL_TEMPLATES).map(([id, template]) => (
                <option key={id} value={id}>{t(template.label)}</option>
              ))}
              <option value="custom">{t("setup.email.templateCustom")}</option>
            </Select>
          </div>

          {requiresRound && !roundId && (
            <Alert tone="warning">{t("setup.email.chooseRound")}</Alert>
          )}
          {credentialConflict && (
            <Alert tone="danger" role="alert">
              {t("setup.email.credentialConflict", { email: credentialConflict })}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
            <span>
              {plural(
                includesPrivateCredentials ? "setup.email.recipientCountIndividual" : "setup.email.recipientCountUnique",
                recipients.length
              )}
            </span>
            {overLimit && (
              <StatusPill tone="danger">{t("setup.email.overLimit", { limit: MAX_CAMPAIGN_RECIPIENTS })}</StatusPill>
            )}
          </div>
          <p className="text-xs text-fg-muted">{t("setup.email.teamEmailHelp")}</p>

          <Input
            label={t("setup.email.subjectLabel")}
            value={subject}
            maxLength={200}
            onChange={(event) => {
              setSubject(event.target.value);
              setTemplateId("custom");
              clearCampaignResult();
            }}
          />
          <Textarea
            label={t("setup.email.messageLabel")}
            value={body}
            maxLength={20_000}
            rows={9}
            onChange={(event) => {
              setBody(event.target.value);
              setTemplateId("custom");
              clearCampaignResult();
            }}
          />

          <div className="rounded-md border border-border bg-muted p-3 text-xs text-fg">
            <p className="font-semibold">{t("setup.email.variablesTitle")}</p>
            <p className="mt-1 break-words font-mono">
              {"{{name}} {{email}} {{tournament}} {{team}} {{institution}} {{round}} {{debate}} {{venue}} {{venue_url}} {{chair}} {{panellists}} {{private_url}} {{passcode}} {{key}} {{position}} {{long_name}} {{side}} {{result}} {{points}} {{ballot}} {{speakers}} {{code_name}} {{emoji}} {{break_categories}}"}
            </p>
            <p className="mt-1 text-fg-muted">{t("setup.email.variablesHelp")}</p>
          </div>

          {previewError && <Alert tone="danger" role="alert">{previewError}</Alert>}
          {preview && (
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-xs font-semibold text-fg">
                {t("setup.email.previewSummary", { name: recipients[0].name })}
              </summary>
              <p className="mt-3 text-sm font-semibold text-fg">{preview.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-fg-muted">{preview.body}</pre>
            </details>
          )}

          {canConfirm ? (
            <Checkbox
              label={plural("setup.email.confirmSend", recipients.length)}
              checked={confirmedSend}
              onChange={(event) => setConfirmedSend(event.target.checked)}
            />
          ) : null}

          <Button
            variant="primary"
            onClick={sendCampaign}
            loading={sendingCampaign}
            loadingText={t("setup.email.sending")}
            disabled={
              !confirmedSend ||
              recipients.length === 0 ||
              overLimit ||
              Boolean(credentialConflict) ||
              (requiresRound && !roundId) ||
              Boolean(previewError)
            }
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {plural("setup.email.sendTo", recipients.length)}
          </Button>

          {campaignError && <Alert tone="danger" role="alert">{campaignError}</Alert>}
          {campaignResult && (
            <Alert
              role="status"
              tone={campaignResult.failed > 0 ? "warning" : "success"}
              title={t("setup.email.campaignResult", { sent: campaignResult.sent, failed: campaignResult.failed })}
            >
              {campaignResult.failed > 0 && (
                <ul className="list-inside list-disc text-danger">
                  {campaignResult.results.filter((result) => !result.sent).map((result) => (
                    <li key={result.email} className="break-words">
                      {result.email}{result.error ? ` — ${result.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
        </CardBody>
      </Card>

      <AutomaticNotificationsPanel onSent={() => void refreshCampaignHistory()} />

      {user && tournament && (
        <EmailSettingsPanel
          tournamentId={tournament.id}
          user={user}
          onUseTemplate={(template, event) => {
            setTemplateId("custom");
            // Tabbycat sends team registration details to every team's speakers.
            if (event === "team_registration") setRecipientGroup("all_teams");
            setSubject(template.subject);
            setBody(template.body);
            clearCampaignResult();
          }}
        />
      )}

      <Card>
        <CardHeader
          icon={<History aria-hidden="true" />}
          title={t("setup.email.historyTitle")}
          description={t("setup.email.historyDescription")}
          actions={
            <Button
              size="sm"
              onClick={() => void refreshCampaignHistory()}
              loading={historyLoading}
              loadingText={t("setup.email.refreshing")}
            >
              <RefreshCw aria-hidden="true" />
              {t("setup.common.refresh")}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {historyError !== null && (
            <Alert tone="danger" role="alert">{historyError || t("setup.email.historyLoadFailed")}</Alert>
          )}
          {historyLoading && campaignHistory.length === 0 && (
            <div className="space-y-2">
              <p role="status" className="text-xs text-fg-muted">{t("setup.email.historyLoading")}</p>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          )}
          {!historyLoading && campaignHistory.length === 0 && historyError === null && (
            <EmptyState icon={<Mail aria-hidden="true" />} title={t("setup.email.historyEmpty")} />
          )}
          {campaignHistory.map((campaign) => {
            const deliveryCounts =
              campaign.delivery && Object.keys(campaign.delivery).length > 0
                ? Object.entries(
                    Object.values(campaign.delivery).reduce<Record<string, number>>((counts, status) => {
                      counts[status.event] = (counts[status.event] ?? 0) + 1;
                      return counts;
                    }, {})
                  ).map(([event, count]) => t("setup.email.deliveryCount", { count, event }))
                : [];
            return (
              <article key={campaign.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-sm font-semibold text-fg">{campaign.subjectTemplate}</p>
                    <p className="text-xs text-fg-muted">
                      {formatDateTime(campaign.createdAt)} · {t(RECIPIENT_GROUP_LABELS[campaign.recipientGroup])}
                      {campaign.roundName ? ` · ${campaign.roundName}` : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                      <span>
                        {t("setup.email.sentBy", {
                          name: campaign.senderName || campaign.senderEmail || t("setup.email.unknownSender"),
                        })}
                      </span>
                      {campaign.retryOf && <Badge>{t("setup.email.retryAttempt")}</Badge>}
                      {campaign.notificationKey && <Badge tone="info">{t("setup.email.automaticNotification")}</Badge>}
                      {campaign.status === "sending" && (
                        <StatusPill tone="warning">{t("setup.email.inProgress")}</StatusPill>
                      )}
                    </div>
                    <p className="text-xs font-medium text-fg">
                      {t("setup.email.campaignCounts", { sent: campaign.sent, failed: campaign.failed })}
                      {deliveryCounts.length > 0 && (
                        <> · {t("setup.email.deliverySummary", { summary: formatList(deliveryCounts) })}</>
                      )}
                    </p>
                  </div>
                  {campaign.failedRecipients.length > 0 &&
                    campaign.status !== "sending" &&
                    !campaign.retriedBy && (
                    <Button
                      size="sm"
                      onClick={() => void retryFailed(campaign.id)}
                      disabled={Boolean(retryingCampaignId)}
                      loading={retryingCampaignId === campaign.id}
                      loadingText={t("setup.email.retrying")}
                      className="shrink-0"
                    >
                      <RefreshCw aria-hidden="true" />
                      {plural("setup.email.retryFailed", campaign.failedRecipients.length)}
                    </Button>
                  )}
                </div>
                {campaign.failedRecipients.length > 0 && (
                  <details className="mt-3 border-t border-border pt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-danger">
                      {t("setup.email.viewFailed")}
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-danger">
                      {campaign.results.filter((result) => !result.sent).map((result) => (
                        <li key={result.email} className="break-words">
                          {result.email}{result.error ? ` — ${result.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}
