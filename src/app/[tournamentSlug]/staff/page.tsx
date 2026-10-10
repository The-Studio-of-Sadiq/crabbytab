"use client";

import React, { useEffect, useState } from "react";
import { Shield, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";

interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  role: "dataEntry";
  addedAt: string;
}

export default function StaffPage() {
  const { tournament, isOwnerOrAdmin } = useTournament();
  const { user, loading: authLoading } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [email, setEmail] = useState("");
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
        const result = await response.json() as { error?: string; staff?: StaffMember[] };
        if (!response.ok) throw new Error(result.error || "Could not load staff.");
        if (active) setStaff(result.staff || []);
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

  const addAssistant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !tournament || !email.trim()) return;
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
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { error?: string; uid?: string; email?: string; role?: "dataEntry" };
      if (!response.ok) throw new Error(result.error || "Could not assign staff access.");
      setStaff((current) => [
        ...current.filter((member) => member.uid !== result.uid),
        {
          uid: result.uid!,
          email: result.email || email.trim(),
          displayName: "",
          role: result.role || "dataEntry",
          addedAt: new Date().toISOString(),
        },
      ].sort((left, right) => left.email.localeCompare(right.email)));
      setEmail("");
      setMessage("Data-entry access added.");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not assign staff access.");
    } finally {
      setBusy(false);
    }
  };

  const removeAssistant = async (member: StaffMember) => {
    if (!user || !tournament || !window.confirm(`Remove data-entry access for ${member.email}?`)) return;
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
      setMessage("Data-entry access removed.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove staff access.");
    } finally {
      setBusy(false);
    }
  };

  if (authLoading || loading) return <p className="p-6 text-sm text-gray-600">Loading staff…</p>;
  if (!isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-red-700">Only tournament administrators can manage staff.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-[#d0d7de] pb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Shield className="h-5 w-5 text-blue-700" />
          Staff access
        </h1>
        <p className="mt-1 text-sm text-gray-600">Assign existing accounts as data-entry assistants for {tournament?.shortName || tournament?.name}.</p>
      </header>

      <form onSubmit={addAssistant} className="flex max-w-2xl flex-col gap-3 border-b border-gray-200 pb-6 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="staff-email" className="mb-1 block text-xs font-semibold text-gray-700">Account email</label>
          <input
            id="staff-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex items-center justify-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          Add assistant
        </button>
      </form>

      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}

      <section aria-labelledby="assistant-list-heading">
        <h2 id="assistant-list-heading" className="mb-3 text-sm font-bold text-gray-900">Data-entry assistants ({staff.length})</h2>
        {staff.length === 0 ? (
          <p className="text-sm text-gray-500">No assistants assigned.</p>
        ) : (
          <ul className="divide-y divide-gray-200 border-y border-gray-200">
            {staff.map((member) => (
              <li key={member.uid} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{member.displayName || member.email}</p>
                  {member.displayName && <p className="truncate text-xs text-gray-600">{member.email}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => removeAssistant(member)}
                  disabled={busy}
                  aria-label={`Remove ${member.email}`}
                  title="Remove assistant"
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