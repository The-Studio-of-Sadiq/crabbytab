"use client";

import React, { useEffect, useState } from "react";
import { Shield, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";

interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "dataEntry";
  addedAt: string;
}

export default function StaffPage() {
  const { tournament, isOwnerOrAdmin } = useTournament();
  const { user, loading: authLoading } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [emails, setEmails] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "dataEntry">("dataEntry");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function loadStaff() {
      if (!user || !tournament || !isOwnerOrAdmin) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json() as {
          error?: string;
          staff?: StaffMember[];
        };
        if (!response.ok) throw new Error(result.error || "Could not load staff.");
        if (active) {
          setStaff(result.staff || []);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load staff.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadStaff();
    return () => {
      active = false;
    };
  }, [user, tournament, isOwnerOrAdmin]);

  const addStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    const selectedEmails = [...new Set(emails.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean))];
    if (!user || !tournament || selectedEmails.length === 0) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emails: selectedEmails, role: selectedRole }),
      });
      const result = await response.json() as { error?: string; staff?: StaffMember[] };
      if (!response.ok) throw new Error(result.error || "Could not assign tournament access.");
      setStaff((current) => [
        ...current.filter((member) => !result.staff?.some((added) => added.uid === member.uid)),
        ...(result.staff || []),
      ].sort((left, right) => left.email.localeCompare(right.email)));
      setEmails("");
      setMessage(`${selectedRole === "admin" ? "Administrator" : "Data-entry"} access assigned to ${result.staff?.length || 0} account(s).`);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not assign tournament access.");
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (member: StaffMember) => {
    if (!user || !tournament || !window.confirm(`Remove ${member.role === "admin" ? "administrator" : "data-entry"} access for ${member.email}?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uid: member.uid }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not remove staff access.");
      setStaff((current) => current.filter((item) => item.uid !== member.uid));
      setMessage("Tournament access removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove staff access.");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || loading) return <p className="p-6 text-sm text-gray-600">Loading staff…</p>;
  if (!user || !isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-red-700">Sign in as a tournament administrator to manage access.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-[#d0d7de] pb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Shield className="h-5 w-5 text-blue-700" />
          Tournament access
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Assign existing Firebase Authentication accounts as administrators or data-entry staff for this tournament only.
        </p>
      </header>

      <form onSubmit={addStaff} className="max-w-2xl space-y-3 border-b border-gray-200 pb-6">
        <label className="block text-sm font-medium text-gray-800">
          Existing account email addresses
          <textarea
            value={emails}
            onChange={(event) => setEmails(event.target.value)}
            rows={3}
            autoComplete="off"
            placeholder="person@example.com"
            aria-describedby="staff-email-help"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 font-normal"
          />
        </label>
        <p id="staff-email-help" className="text-xs text-gray-600">
          Enter one or more emails, separated by spaces, commas, semicolons, or new lines. Accounts must already exist.
        </p>
        <label className="block max-w-xs text-sm font-medium text-gray-800">
          Tournament role
          <select
            value={selectedRole}
            onChange={(event) => {
              const role = event.target.value;
              if (role === "admin" || role === "dataEntry") setSelectedRole(role);
            }}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2"
          >
            <option value="dataEntry">Data-entry staff</option>
            <option value="admin">Tournament administrator</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy || !emails.trim()}
          className="inline-flex items-center justify-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          Assign selected access
        </button>
      </form>

      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      <section aria-labelledby="assistant-list-heading">
        <h2 id="assistant-list-heading" className="mb-3 text-sm font-bold text-gray-900">Assigned to this tournament ({staff.length})</h2>
        {staff.length === 0 ? (
          <p className="text-sm text-gray-500">No staff accounts assigned to this tournament.</p>
        ) : (
          <ul className="divide-y divide-gray-200 border-y border-gray-200">
            {staff.map((member) => (
              <li key={member.uid} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{member.displayName || member.email}</p>
                  {member.displayName && <p className="truncate text-xs text-gray-600">{member.email}</p>}
                  <p className="text-xs text-gray-500">{member.role === "admin" ? "Tournament administrator" : "Data-entry staff"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeStaff(member)}
                  disabled={busy}
                  aria-label={`Remove ${member.email}`}
                  title="Remove tournament access"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}