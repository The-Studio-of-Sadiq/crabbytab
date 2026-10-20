"use client";

import React, { useEffect, useState } from "react";

import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { createSeededRng, randomSeed } from "@/lib/draw/rng";
import { generateTeamCodeNames, hasCodeName, assignTeamEmoji, type CodeNameMethod } from "@/lib/codeNames";
import { getPublicSiteSettings, PUBLIC_TEXT_MAX_LENGTH, publicUsesTeamCodeNames } from "@/lib/publicFeatures";
import type { TournamentPreferences } from "@/types";

type SetPrefs = React.Dispatch<React.SetStateAction<TournamentPreferences>>;

/** Drops a key instead of storing undefined (Firestore rejects undefined values). */
function withValue<K extends keyof TournamentPreferences>(
  current: TournamentPreferences,
  key: K,
  value: TournamentPreferences[K] | undefined
): TournamentPreferences {
  const next = { ...current };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

function limitValue(raw: string): number | undefined {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Public-site settings (Tabbycat public_features / ui_options) on the Public Visibility page. The
 * per-item releases (adjudicator tab, scoresheets, diversity, ...) are on the Public release panel.
 */
export function PublicSiteSettingsFields({ prefs, setPrefs }: { prefs: TournamentPreferences; setPrefs: SetPrefs }) {
  const site = getPublicSiteSettings(prefs);
  const set = <K extends keyof TournamentPreferences>(key: K, value: TournamentPreferences[K] | undefined) =>
    setPrefs((current) => withValue(current, key, value));

  return (
    <div className="space-y-5 border-t border-gray-100 pt-4">
      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-700">Draw and tabs</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Public draw"
            value={site.drawMode}
            help="Current round only shows the latest released draw (Tabbycat public_draw)."
            onChange={(event) => {
              const mode = event.target.value as TournamentPreferences["publicDrawMode"];
              // The legacy switch is kept in step for older readers.
              setPrefs((current) => ({ ...current, publicDrawMode: mode, publicDraw: mode !== "off" }));
            }}
          >
            <option value="off">Off</option>
            <option value="current">Current round only</option>
            <option value="all">All released rounds</option>
          </Select>
          <Select
            label="Adjudicator tab shows"
            value={site.adjudicatorTabShows}
            onChange={(event) => set("adjudicatorTabShows", event.target.value as TournamentPreferences["adjudicatorTabShows"])}
            help="Release the adjudicator tab from the Public release panel."
          >
            <option value="test">Base score only</option>
            <option value="final">Final (feedback-blended) score only</option>
            <option value="all">Base, final and per-round feedback</option>
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {([
            ["teamTabLimit", "Team tab: top N"],
            ["speakerTabLimit", "Speaker tab: top N"],
            ["repliesTabLimit", "Replies tab: top N"],
          ] as const).map(([key, label]) => (
            <Input
              key={key}
              type="number"
              min={0}
              step={1}
              label={label}
              value={prefs[key] ?? 0}
              onChange={(event) => set(key, limitValue(event.target.value))}
            />
          ))}
          <Input
            type="number"
            min={-1}
            step={1}
            label="Break page metrics"
            help="-1 all, 0 none"
            value={prefs.publicBreakMetrics ?? -1}
            onChange={(event) => {
              const value = Math.floor(Number(event.target.value));
              set("publicBreakMetrics", Number.isFinite(value) && value >= 0 ? value : undefined);
            }}
          />
        </div>
        <p className="text-[11px] text-gray-500">
          0 shows every rank. With a limit, the tab is computed when pages are published and rounds seen only through the
          released tab publish no individual results, so ranks below the cutoff cannot be worked out.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label="Show break categories on the participants page"
            checked={site.breakCategoriesOnParticipants}
            onChange={(event) => set("publicBreakCategories", event.target.checked || undefined)}
          />
          <Select
            label="Motions order"
            value={site.motionsOrder}
            onChange={(event) => set("publicMotionsOrder", event.target.value as TournamentPreferences["publicMotionsOrder"])}
          >
            <option value="forward">Earliest round first</option>
            <option value="reverse">Latest round first</option>
          </Select>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-700">Names and anonymity</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Team code names"
            value={site.teamCodeNames}
            onChange={(event) => set("teamCodeNames", event.target.value as TournamentPreferences["teamCodeNames"])}
            help="Code-name modes publish only the code name; real names never leave the server."
          >
            <option value="off">Off</option>
            <option value="all-tooltips">Real names, code names as tooltips</option>
            <option value="admin-tooltips-code">Code names publicly (real names for staff)</option>
            <option value="admin-tooltips-real">Code names publicly (staff see both)</option>
            <option value="everywhere">Code names everywhere</option>
          </Select>
          <Select
            label="Speaker and adjudicator code names"
            value={site.participantCodeNames}
            onChange={(event) => set("participantCodeNames", event.target.value as TournamentPreferences["participantCodeNames"])}
            help="Set code names in the participant directory."
          >
            <option value="off">Off</option>
            <option value="everywhere">Code names on public pages</option>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label="Show team institutions"
            checked={site.showTeamInstitutions}
            onChange={(event) => set("showTeamInstitutions", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label="Show adjudicator institutions"
            checked={site.showAdjudicatorInstitutions}
            onChange={(event) => set("showAdjudicatorInstitutions", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label="Show team emoji"
            checked={site.showEmoji}
            onChange={(event) => set("showEmoji", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label="Show speakers in the draw"
            checked={site.showSpeakersInDraw}
            onChange={(event) => set("showSpeakersInDraw", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label="Show splitting adjudicators"
            description="Marks voting adjudicators whose sheet chose the losing team."
            checked={site.showSplittingAdjudicators}
            onChange={(event) => set("showSplittingAdjudicators", event.target.checked || undefined)}
          />
        </div>
        <p className="text-[11px] text-gray-500">
          Mark individual speakers and adjudicators as anonymous in the participant directory: their names are redacted
          on every public page.
        </p>
        <CodeNameTools usesCodeNames={publicUsesTeamCodeNames(site.teamCodeNames)} />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-700">Public ballot and feedback forms</h4>
        <p className="text-[11px] text-gray-500">
          Forms on the public site, in addition to private URLs (Tabbycat&apos;s &quot;publicly accessible form&quot;). Anyone
          can choose a name, so submissions are saved unconfirmed for the tab room, only for rounds whose draw and
          adjudicators are public, and are rate-limited per network.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Checkbox
            label="Public ballot form"
            checked={site.ballotForm}
            onChange={(event) => set("publicBallotForm", event.target.checked || undefined)}
          />
          <Checkbox
            label="Public feedback form"
            checked={site.feedbackForm}
            onChange={(event) => set("publicFeedbackForm", event.target.checked || undefined)}
          />
          <Checkbox
            label="Require a password"
            checked={site.formsUsePassword}
            onChange={(event) => set("publicFormsUsePassword", event.target.checked || undefined)}
          />
        </div>
        <PublicFormPasswordControl required={site.formsUsePassword} />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-700">Public homepage</h4>
        <Select
          label="Search engines"
          value={site.searchEngineIndexing}
          onChange={(event) => set("searchEngineIndexing", event.target.value as TournamentPreferences["searchEngineIndexing"])}
          help="Adds a noindex flag; search engines may ignore it, so it is not a privacy control."
          wrapperClassName="max-w-md"
        >
          <option value="all">Allow every public page to be indexed</option>
          <option value="homepage-only">Only the public tab homepage</option>
          <option value="none">No pages</option>
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <Textarea
            label="Welcome message"
            rows={4}
            maxLength={PUBLIC_TEXT_MAX_LENGTH}
            value={prefs.welcomeMessage ?? ""}
            onChange={(event) => set("welcomeMessage", event.target.value || undefined)}
            help="Plain text, shown at the top of the public tab."
          />
          <Textarea
            label="Tournament staff"
            rows={4}
            maxLength={PUBLIC_TEXT_MAX_LENGTH}
            value={prefs.tournamentStaff ?? ""}
            onChange={(event) => set("tournamentStaff", event.target.value || undefined)}
            help="Credits for the convenors, adjudication core and tab team."
          />
        </div>
      </section>
    </div>
  );
}

/** Fills in missing team emoji and code names (Tabbycat's code-name generators). */
function CodeNameTools({ usesCodeNames }: { usesCodeNames: boolean }) {
  const { teams, saveEntityBatch, isOwnerOrAdmin } = useTournament();
  const [method, setMethod] = useState<CodeNameMethod>("emoji");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const missingCodes = teams.filter((team) => !hasCodeName(team)).length;
  const missingEmoji = teams.filter((team) => !team.emoji).length;

  const run = async (kind: "codes" | "emoji") => {
    setBusy(true);
    setStatus("");
    try {
      const rng = createSeededRng(randomSeed());
      const updated = kind === "codes" ? generateTeamCodeNames(teams, method, rng) : assignTeamEmoji(teams, rng);
      if (updated.length > 0) await saveEntityBatch({ teamsUpdated: updated }, kind === "codes" ? "code-name generator" : "emoji generator");
      setStatus(`${updated.length} team(s) updated.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update the teams.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2 text-xs">
      <p className="text-gray-700">
        {missingCodes} of {teams.length} team(s) have no code name; {missingEmoji} have no emoji.
        {usesCodeNames && missingCodes > 0 && " Teams without a code name appear without a name on public pages."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Code name standard"
          value={method}
          onChange={(event) => setMethod(event.target.value as CodeNameMethod)}
          disabled={!isOwnerOrAdmin || busy}
        >
          <option value="emoji">Emoji names</option>
          <option value="last_names">Speakers&apos; last names</option>
        </Select>
        <Button type="button" size="sm" variant="secondary" disabled={!isOwnerOrAdmin || busy || missingCodes === 0} onClick={() => void run("codes")}>
          Generate missing code names
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!isOwnerOrAdmin || busy || missingEmoji === 0} onClick={() => void run("emoji")}>
          Assign missing emoji
        </Button>
      </div>
      {status && <p role="status" className="text-gray-600">{status}</p>}
    </div>
  );
}

/** Sets or clears the public form password, stored server-side as a hash (never in preferences). */
function PublicFormPasswordControl({ required }: { required: boolean }) {
  const { tournament, isOwnerOrAdmin } = useTournament();
  const { user } = useAuth();
  const [state, setState] = useState<{ passwordSet: boolean; updatedAt: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tournamentId = tournament?.id;

  useEffect(() => {
    if (!user || !tournamentId || !isOwnerOrAdmin) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/public-forms`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          cache: "no-store",
        });
        const result = (await response.json().catch(() => ({}))) as { passwordSet?: boolean; updatedAt?: string | null; error?: string };
        if (!active) return;
        if (response.ok) setState({ passwordSet: result.passwordSet === true, updatedAt: result.updatedAt ?? null });
        else setMessage(result.error || "Could not read the password setting.");
      } catch {
        if (active) setMessage("Could not read the password setting.");
      }
    })();
    return () => {
      active = false;
    };
  }, [user, tournamentId, isOwnerOrAdmin]);

  const save = async (next: string | null) => {
    if (!user || !tournamentId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/public-forms`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: next }),
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as { passwordSet?: boolean; updatedAt?: string | null; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save the password.");
      setState({ passwordSet: result.passwordSet === true, updatedAt: result.updatedAt ?? null });
      setPassword("");
      setMessage(next === null ? "Password removed." : "Password saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the password.");
    } finally {
      setBusy(false);
    }
  };

  if (!isOwnerOrAdmin) return null;
  if (!user) {
    return <p className="text-[11px] text-gray-500">Sign in with cloud sync to set the form password.</p>;
  }
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2 text-xs">
      <p className="text-gray-700">
        {state === null
          ? "Checking the password…"
          : state.passwordSet
            ? `A password is set${state.updatedAt ? ` (changed ${new Date(state.updatedAt).toLocaleString()})` : ""}.`
            : required
              ? "No password is set yet: the forms refuse submissions until one is."
              : "No password is set."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          type="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          wrapperClassName="w-56"
        />
        <Button type="button" size="sm" variant="secondary" disabled={busy || password.trim().length === 0} onClick={() => void save(password)}>
          Save password
        </Button>
        {state?.passwordSet && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
            Remove password
          </Button>
        )}
      </div>
      {message && <p role="status" className="text-gray-600">{message}</p>}
    </div>
  );
}
