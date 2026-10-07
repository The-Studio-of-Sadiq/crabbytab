"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Send, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import {
  EMAIL_RECIPIENT_GROUPS,
  renderEmailTemplate,
  resolveEmailRecipients,
  MAX_CAMPAIGN_RECIPIENTS,
} from "@/lib/email/messaging";
import type {
  EmailCampaignResult,
  EmailRecipientGroup,
  StoredEmailCampaign,
} from "@/lib/email/messaging";

const RECIPIENT_GROUP_LABELS: Record<EmailRecipientGroup, string> = {
  all_teams: "All teams",
  breaking_teams: "Breaking teams",
  non_breaking_teams: "Non-breaking teams",
  all_adjudicators: "All adjudicators",
  checked_in_adjudicators: "Checked-in adjudicators",
  trainees: "All trainees",
  all_participants: "All participants",
  round_participants: "Teams in a round",
  round_adjudicators: "Adjudicators in a round",
  chairs: "Chairs in a round",
  panellists: "Panellists in a round",
};

const ROUND_RECIPIENT_GROUPS: EmailRecipientGroup[] = [
  "round_participants",
  "round_adjudicators",
  "chairs",
  "panellists",
];

const EMAIL_TEMPLATES = {
  announcement: {
    label: "Tournament announcement",
    subject: "{{tournament}} announcement",
    body: "Hi {{name}},\n\nAn update from {{tournament}}.\n\nBest,\nTournament Staff",
  },
  round_details: {
    label: "Round details",
    subject: "{{tournament}} — {{round}} details",
    body: "Hi {{name}},\n\nYour details for {{round}}:\n{{debate}}\nVenue: {{venue}}\nChair: {{chair}}\n\nBest,\nTournament Staff",
  },
  adjudicator_assignment: {
    label: "Adjudicator assignment",
    subject: "{{tournament}} — {{round}} adjudicator assignment",
    body: "Hi {{name}},\n\nYou are assigned to {{debate}} in {{round}}.\nVenue: {{venue}}\nChair: {{chair}}\nPanellists: {{panellists}}\n\nBest,\nTournament Staff",
  },
  feedback_reminder: {
    label: "Feedback reminder",
    subject: "{{tournament}} — please submit feedback",
    body: "Hi {{name}},\n\nPlease remember to submit feedback for {{round}}.\n\nBest,\nTournament Staff",
  },
} as const;

export default function EmailSettingsPage() {
  const {
    tournament,
    isOwnerOrAdmin,
    rounds,
    teams,
    adjudicators,
    debates,
  } = useTournament();
  const { user } = useAuth();
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
  const [historyError, setHistoryError] = useState("");
  const [retryingCampaignId, setRetryingCampaignId] = useState("");

  const refreshCampaignHistory = useCallback(async () => {
    if (!tournament || !user || !isOwnerOrAdmin) return;

    setHistoryLoading(true);
    setHistoryError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/email/history?tournamentId=${encodeURIComponent(tournament.id)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load campaign history.");
      setCampaignHistory(result.campaigns as StoredEmailCampaign[]);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Unable to load campaign history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [tournament, user, isOwnerOrAdmin]);

  useEffect(() => {
    void refreshCampaignHistory();
  }, [refreshCampaignHistory]);

  const selectedRound = rounds.find((round) => round.id === roundId);
  const requiresRound = ROUND_RECIPIENT_GROUPS.includes(recipientGroup);
  const recipients = useMemo(
    () =>
      resolveEmailRecipients(
        recipientGroup,
        teams,
        adjudicators,
        debates,
        rounds.find((round) => round.id === roundId)
      ),
    [recipientGroup, teams, adjudicators, debates, rounds, roundId]
  );

  let preview: { subject: string; body: string } | null = null;
  let previewError = "";
  if (recipients[0] && tournament) {
    try {
      preview = {
        subject: renderEmailTemplate(subject, recipients[0], tournament.name, selectedRound?.name),
        body: renderEmailTemplate(body, recipients[0], tournament.name, selectedRound?.name),
      };
    } catch (cause) {
      previewError = cause instanceof Error ? cause.message : "Invalid template variable.";
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
      if (!response.ok) throw new Error(result.error || "Unable to test SMTP.");
      setTestMessage(result.message);
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : "Unable to test SMTP.");
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
      if (!response.ok) throw new Error(result.error || "Unable to send the campaign.");
      setCampaignResult(result as EmailCampaignResult);
      setConfirmedSend(false);
      await refreshCampaignHistory();
    } catch (cause) {
      setCampaignError(cause instanceof Error ? cause.message : "Unable to send the campaign.");
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
      if (!response.ok) throw new Error(result.error || "Unable to retry failed emails.");
      setCampaignResult(result as EmailCampaignResult);
      await refreshCampaignHistory();
    } catch (cause) {
      setCampaignError(cause instanceof Error ? cause.message : "Unable to retry failed emails.");
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
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Only tournament administrators can manage email settings.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Mail className="h-6 w-6 text-blue-600" />
          Tournament email
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure an SMTP provider for server-side tournament email.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Secure SMTP configuration
        </h2>
        <p className="text-sm text-gray-600">
          SMTP settings are supplied by the deployment operator as server environment variables.
          Credentials are never saved in tournament data or sent to the browser.
        </p>
        <div className="rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-800">
          <div>SMTP_HOST</div>
          <div>SMTP_PORT (default: 587)</div>
          <div>SMTP_SECURE (defaults to true for port 465)</div>
          <div>SMTP_USER</div>
          <div>SMTP_PASS</div>
          <div>SMTP_FROM</div>
          <div>FIREBASE_SERVICE_ACCOUNT_JSON (server-side admin authorization)</div>
        </div>
        <p className="text-xs text-gray-500">
          Add these values to the server deployment environment and redeploy. Use an app password
          or provider-issued credential, not your personal account password. Port 587 uses
          required STARTTLS; port 465 uses implicit TLS. The Firebase service-account JSON must
          have access to read tournament administrator records.
        </p>
        <label className="block max-w-md text-xs font-semibold text-gray-700">
          Test recipient email
          <input
            type="email"
            required
            value={testRecipient}
            onChange={(event) => setTestRecipient(event.target.value)}
            placeholder={user?.email || "name@example.com"}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900"
          />
        </label>
        <button
          type="button"
          onClick={sendTestEmail}
          disabled={testSending || !testRecipient.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {testSending ? "Sending test..." : "Send test email"}
        </button>
        {testMessage && <p role="status" className="text-sm text-emerald-700">{testMessage}</p>}
        {testError && <p role="alert" className="text-sm text-red-700">{testError}</p>}
      </section>

      <section className="space-y-4 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Compose tournament email</h2>
          <p className="mt-1 text-xs text-gray-600">
            Messages are sent separately to protect recipient privacy. Up to {MAX_CAMPAIGN_RECIPIENTS} unique email addresses per send.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-gray-700">
            Recipients
            <select
              value={recipientGroup}
              onChange={(event) => {
                setRecipientGroup(event.target.value as EmailRecipientGroup);
                clearCampaignResult();
              }}
              className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
            >
              {EMAIL_RECIPIENT_GROUPS.map((group) => (
                <option key={group} value={group}>{RECIPIENT_GROUP_LABELS[group]}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-700">
            Round (optional except for round groups)
            <select
              value={roundId}
              onChange={(event) => {
                setRoundId(event.target.value);
                clearCampaignResult();
              }}
              className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
            >
              <option value="">No round</option>
              {rounds.filter((round) => !round.cancelled).map((round) => (
                <option key={round.id} value={round.id}>{round.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-700 sm:col-span-2">
            Template
            <select
              value={templateId}
              onChange={(event) => {
                const nextId = event.target.value as keyof typeof EMAIL_TEMPLATES | "custom";
                setTemplateId(nextId);
                if (nextId !== "custom") {
                  setSubject(EMAIL_TEMPLATES[nextId].subject);
                  setBody(EMAIL_TEMPLATES[nextId].body);
                }
                clearCampaignResult();
              }}
              className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
            >
              {Object.entries(EMAIL_TEMPLATES).map(([id, template]) => (
                <option key={id} value={id}>{template.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>

        {requiresRound && !roundId && (
          <p className="text-sm text-amber-700">Choose a round to resolve this recipient group.</p>
        )}
        <p className={`text-sm font-medium ${recipients.length > MAX_CAMPAIGN_RECIPIENTS ? "text-red-700" : "text-gray-700"}`}>
          {recipients.length} unique recipient{recipients.length === 1 ? "" : "s"} with an email address
          {recipients.length > MAX_CAMPAIGN_RECIPIENTS ? ` — over the ${MAX_CAMPAIGN_RECIPIENTS}-recipient limit` : ""}
        </p>
        <p className="text-xs text-gray-500">
          Team groups use email addresses on team speakers. Add speaker email addresses in participant records to include those teams.
        </p>

        <label className="block text-xs font-semibold text-gray-700">
          Subject
          <input
            value={subject}
            maxLength={200}
            onChange={(event) => {
              setSubject(event.target.value);
              setTemplateId("custom");
              clearCampaignResult();
            }}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="block text-xs font-semibold text-gray-700">
          Message
          <textarea
            value={body}
            maxLength={20_000}
            rows={9}
            onChange={(event) => {
              setBody(event.target.value);
              setTemplateId("custom");
              clearCampaignResult();
            }}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-normal"
          />
        </label>

        <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-700">
          <p className="font-semibold">Template variables</p>
          <p className="mt-1 font-mono">
            {"{{name}} {{email}} {{tournament}} {{team}} {{institution}} {{round}} {{debate}} {{venue}} {{chair}} {{panellists}}"}
          </p>
          <p className="mt-1 text-gray-500">
            Round, debate, and adjudicator details are populated when a round is selected and assignments exist.
          </p>
        </div>

        {previewError && <p role="alert" className="text-sm text-red-700">{previewError}</p>}
        {preview && (
          <details className="rounded border border-gray-200 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-gray-700">
              Preview for {recipients[0].name}
            </summary>
            <p className="mt-3 text-sm font-semibold text-gray-900">{preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-gray-700">{preview.body}</pre>
          </details>
        )}

        {recipients.length > 0 &&
        recipients.length <= MAX_CAMPAIGN_RECIPIENTS &&
        (!requiresRound || Boolean(roundId)) ? (
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={confirmedSend}
              onChange={(event) => setConfirmedSend(event.target.checked)}
              className="mt-0.5"
            />
            <span>I confirm sending this email to {recipients.length} individual recipient{recipients.length === 1 ? "" : "s"}.</span>
          </label>
        ) : null}

        <button
          type="button"
          onClick={sendCampaign}
          disabled={
            sendingCampaign ||
            !confirmedSend ||
            recipients.length === 0 ||
            recipients.length > MAX_CAMPAIGN_RECIPIENTS ||
            (requiresRound && !roundId) ||
            Boolean(previewError)
          }
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {sendingCampaign ? "Sending..." : `Send to ${recipients.length} recipients`}
        </button>

        {campaignError && <p role="alert" className="text-sm text-red-700">{campaignError}</p>}
        {campaignResult && (
          <div role="status" className="space-y-2 rounded-md border border-gray-200 p-3 text-sm">
            <p className="font-semibold text-gray-900">
              Sent {campaignResult.sent}; failed {campaignResult.failed}.
            </p>
            {campaignResult.failed > 0 && (
              <ul className="list-inside list-disc text-red-700">
                {campaignResult.results.filter((result) => !result.sent).map((result) => (
                  <li key={result.email}>
                    {result.email}{result.error ? ` — ${result.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-[#d0d7de] bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Campaign history</h2>
            <p className="mt-1 text-xs text-gray-600">
              The latest 50 sends and retry attempts are stored for tournament administrators.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshCampaignHistory()}
            disabled={historyLoading}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50"
          >
            {historyLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {historyError && <p role="alert" className="text-sm text-red-700">{historyError}</p>}
        {!historyLoading && campaignHistory.length === 0 && !historyError && (
          <p className="text-sm text-gray-500">No email campaigns have been sent yet.</p>
        )}
        <div className="space-y-3">
          {campaignHistory.map((campaign) => (
            <article key={campaign.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-semibold text-gray-900">
                    {campaign.subjectTemplate}
                  </p>
                  <p className="text-xs text-gray-600">
                    {new Date(campaign.createdAt).toLocaleString()} · {RECIPIENT_GROUP_LABELS[campaign.recipientGroup]}
                    {campaign.roundName ? ` · ${campaign.roundName}` : ""}
                  </p>
                  <p className="text-xs text-gray-500">
                    Sent by {campaign.senderName || campaign.senderEmail || "Unknown"}
                    {campaign.retryOf ? " · Retry attempt" : ""}
                    {campaign.status === "sending" ? " · In progress" : ""}
                  </p>
                  <p className="text-xs font-medium text-gray-700">
                    {campaign.sent} sent · {campaign.failed} failed
                  </p>
                </div>
                {campaign.failedRecipients.length > 0 &&
                  campaign.status !== "sending" &&
                  !campaign.retriedBy && (
                  <button
                    type="button"
                    onClick={() => void retryFailed(campaign.id)}
                    disabled={Boolean(retryingCampaignId)}
                    className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {retryingCampaignId === campaign.id ? "Retrying..." : `Retry ${campaign.failedRecipients.length} failed`}
                  </button>
                )}
              </div>
              {campaign.failedRecipients.length > 0 && (
                <details className="mt-3 border-t border-gray-100 pt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-red-700">
                    View failed recipients and errors
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-red-700">
                    {campaign.results.filter((result) => !result.sent).map((result) => (
                      <li key={result.email}>
                        {result.email}{result.error ? ` — ${result.error}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
