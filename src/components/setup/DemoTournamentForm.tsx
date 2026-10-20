"use client";

import React, { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isSlugUsedOnDevice, saveImportedTournamentLocally } from "@/features/tournament/application/importedTournamentStorage";
import { randomSeed } from "@/lib/draw/rng";
import { getLocalStore } from "@/lib/offline/localStore";
import { buildDemoTournament, DEMO_SLUG_PREFIX, type DemoFormat } from "@/lib/rehearsal/demoTournament";
import { validateSlug } from "@/lib/setup/presets";

/**
 * Creates a demo tournament on this device for rehearsals and training. Like the DebateXML
 * import it creates a new local tournament only (never overwriting one) and needs a global
 * administrator, the same rule as creating any tournament.
 */
export function DemoTournamentForm() {
  const router = useRouter();
  const { user, isGlobalAdmin, loading: authLoading } = useAuth();
  const ids = { format: useId(), slug: useId() };
  const [format, setFormat] = useState<DemoFormat>("bp");
  const [slug, setSlug] = useState(() => `${DEMO_SLUG_PREFIX}bp-${randomSeed() % 10000}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (authLoading) return <p role="status" className="text-sm text-gray-600">Checking administrator access…</p>;
  if (!isGlobalAdmin) {
    return (
      <div role="alert" className="rounded border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Only a global administrator can create a tournament, including a demo tournament.
      </div>
    );
  }

  const changeFormat = (next: DemoFormat) => {
    setFormat(next);
    if (/^demo-(bp|wsdc)-\d+$/.test(slug)) setSlug(`${DEMO_SLUG_PREFIX}${next}-${randomSeed() % 10000}`);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const slugError = validateSlug(slug) || (slug.startsWith(DEMO_SLUG_PREFIX) ? "" : `The URL must start with "${DEMO_SLUG_PREFIX}".`);
    if (slugError) {
      setError(slugError);
      return;
    }
    setBusy(true);
    try {
      if (await isSlugUsedOnDevice(getLocalStore(), slug)) {
        throw new Error(`"${slug}" already exists on this device. Choose a different URL.`);
      }
      const demo = buildDemoTournament({ format, slug, ownerId: user?.uid || "local", seed: randomSeed() });
      await saveImportedTournamentLocally(getLocalStore(), demo);
      router.push(`/${slug}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The demo tournament could not be created. Nothing was saved.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900">
          <FlaskConical className="h-6 w-6 text-blue-700" aria-hidden="true" />
          Load a demo tournament
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          A practice tournament on this device: institutions, teams and speakers, adjudicators with scores and
          conflicts, rooms, rounds, motions and break categories. Draw it, then use <strong>Rehearsal tools</strong> to
          simulate results and feedback. Its URL starts with <span className="font-mono">demo-</span> and its name with
          “Demo —”, so it is never mistaken for a real tournament.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor={ids.format} className="block text-xs font-semibold text-gray-700">
          Format
          <select
            id={ids.format}
            value={format}
            onChange={(event) => changeFormat(event.target.value as DemoFormat)}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="bp">British Parliamentary (24 teams)</option>
            <option value="wsdc">WSDC (16 teams, three speakers and a reply)</option>
          </select>
        </label>
        <label htmlFor={ids.slug} className="block text-xs font-semibold text-gray-700">
          URL slug
          <input
            id={ids.slug}
            value={slug}
            onChange={(event) => setSlug(event.target.value.trim().toLowerCase())}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
            aria-describedby={`${ids.slug}-hint`}
          />
          <span id={`${ids.slug}-hint`} className="mt-1 block font-normal text-gray-500">Opens at /{slug || "…"}.</span>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create demo tournament"}
      </button>
    </form>
  );
}
