"use client";

import { useCallback, useEffect, useState } from "react";
import type { Debate, Round, Team, Tournament } from "@/types";
import type { ParticipantMotion } from "@/lib/ballots/participantMotion";
import type { PublicFeedbackOption, PublicFormKind, PublicFormsDirectory, PublicFormSourceType } from "@/lib/publicForms";

/** Client side of /api/public/tournaments/{slug}/forms (docs/public-pages-and-notifications.md). */

export interface PublicFormsDirectoryResponse {
  tournament: { name: string; shortName?: string; format?: Tournament["format"] };
  forms: PublicFormsDirectory | null;
}

export interface PublicFormTournament {
  id: string;
  name: string;
  format: Tournament["format"];
  preferences: Tournament["preferences"];
}

export interface PublicBallotContext {
  kind: "ballot";
  tournament: PublicFormTournament;
  round: Pick<Round, "id" | "name" | "seq" | "stage">;
  adjudicator: { id: string; name: string; isChair: boolean };
  debate: Debate;
  teams: Array<Pick<Team, "id" | "name"> & { speakers: Team["speakers"] }>;
  /** The round's motions, when the ballot asks which was debated (several motions, motions on). */
  motions?: ParticipantMotion[];
}

export interface PublicFeedbackContext {
  kind: "feedback";
  tournament: PublicFormTournament;
  source: { type: PublicFormSourceType; id: string; name: string };
  options: PublicFeedbackOption[];
}

/** A failed request: the server's message (shown as written) and whether the password was wrong. */
export class PublicFormRequestError extends Error {
  constructor(message: string, readonly passwordRejected = false) {
    super(message);
    this.name = "PublicFormRequestError";
  }
}

function formsUrl(slug: string): string {
  return `/api/public/tournaments/${encodeURIComponent(slug)}/forms`;
}

export function usePublicFormsDirectory(slug: string) {
  const [data, setData] = useState<PublicFormsDirectoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(formsUrl(slug));
      const body = (await response.json()) as Partial<PublicFormsDirectoryResponse> & { error?: string };
      if (!response.ok || !body.tournament) throw new Error(body.error || "");
      setData({ tournament: body.tournament, forms: body.forms ?? null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

export async function postPublicForm<T>(
  slug: string,
  body: {
    action: "load" | "submit";
    kind: PublicFormKind;
    sourceType: PublicFormSourceType;
    sourceId: string;
    password?: string;
    ballot?: unknown;
    feedback?: unknown;
  }
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(formsUrl(slug), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new PublicFormRequestError("");
  }
  const result = (await response.json().catch(() => ({}))) as { error?: string; passwordRequired?: boolean };
  if (!response.ok) throw new PublicFormRequestError(result.error || "", result.passwordRequired === true);
  return result as T;
}
