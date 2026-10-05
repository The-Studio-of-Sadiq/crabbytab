"use client";

import { useState } from "react";
import { Mail, Send, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";

export default function EmailSettingsPage() {
  const { tournament, isOwnerOrAdmin } = useTournament();
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const sendTestEmail = async () => {
    if (!tournament || !user) return;

    setSending(true);
    setMessage("");
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/email/test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tournamentId: tournament.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to test SMTP.");
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to test SMTP.");
    } finally {
      setSending(false);
    }
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
        <button
          type="button"
          onClick={sendTestEmail}
          disabled={sending || !user?.email}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {sending ? "Sending test..." : `Send test to ${user?.email || "your account"}`}
        </button>
        {!user?.email && (
          <p className="text-xs text-amber-700">Your signed-in account does not have an email address.</p>
        )}
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>
    </div>
  );
}
