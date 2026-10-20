import type { Team } from "@/types";

/**
 * Per-speaker private URLs (Tabbycat gives every speaker their own `url_key`). Optional and
 * alongside the team's own URL and passcode, which keep working unchanged (existing links and QR
 * codes stay valid). A speaker's URL has its own key and passcode and opens their team's portal:
 * everything it does, it does as that team, never as another team.
 *
 * The team document lists its speakers' keys in `speakerUrlKeys` so the server finds the team
 * with one `array-contains` query; the key and passcode are then checked against the speaker
 * record itself, so a key left in the index after its speaker was removed opens nothing.
 */

/** The index stored on the team: every speaker key, sorted. */
export function speakerUrlKeyIndex(team: Pick<Team, "speakers">): string[] {
  return (team.speakers ?? [])
    .map((speaker) => speaker.privateUrlKey)
    .filter((key): key is string => typeof key === "string" && key.length > 0)
    .sort();
}

/**
 * Gives every speaker without a private URL a key and passcode (`force`: new ones for every
 * speaker, which stops their old links). Team keys and passcodes are never touched. Returns only
 * the teams that changed, with their `speakerUrlKeys` index updated.
 */
export function assignSpeakerPrivateUrls(
  teams: readonly Team[],
  generate: (prefix?: string) => string,
  options: { force?: boolean } = {}
): Team[] {
  const changed: Team[] = [];
  for (const team of teams) {
    let touched = false;
    const speakers = (team.speakers ?? []).map((speaker) => {
      if (!options.force && speaker.privateUrlKey && speaker.privatePasscode) return speaker;
      touched = true;
      return {
        ...speaker,
        privateUrlKey: options.force || !speaker.privateUrlKey ? generate("spk") : speaker.privateUrlKey,
        privatePasscode: generate(),
      };
    });
    const next = { ...team, speakers };
    const index = speakerUrlKeyIndex(next);
    const indexChanged = JSON.stringify(index) !== JSON.stringify(team.speakerUrlKeys ?? []);
    if (touched || indexChanged) changed.push({ ...next, speakerUrlKeys: index });
  }
  return changed;
}

/** Removes every speaker URL (the team URLs stay). Returns only the teams that changed. */
export function removeSpeakerPrivateUrls(teams: readonly Team[]): Team[] {
  return teams
    .filter((team) => (team.speakerUrlKeys?.length ?? 0) > 0 || (team.speakers ?? []).some((speaker) => speaker.privateUrlKey))
    .map((team) => {
      const { speakerUrlKeys: _index, ...rest } = team;
      return {
        ...rest,
        speakers: (team.speakers ?? []).map(({ privateUrlKey: _key, privatePasscode: _passcode, ...speaker }) => speaker),
      };
    });
}

export function getSpeakerPrivatePath(tournamentSlug: string, key: string): string {
  return `/${tournamentSlug}/private/speaker/${encodeURIComponent(key)}`;
}
