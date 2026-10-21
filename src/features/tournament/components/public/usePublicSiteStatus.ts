"use client";

import { useEffect, useState } from "react";

export interface PublicSiteStatus {
  /** An audit log release exists. */
  auditReleased: boolean;
  /** The public registration form's state ("open", "not_open", "closed", ...), once known. */
  registrationState: unknown;
}

/**
 * Whether the audit log is released and what state public registration is in, asked once from the
 * edge-cached public routes for the whole public page (site links and the Home tab's Register
 * button). A failed check leaves that item out.
 */
export function usePublicSiteStatus(slug: string): PublicSiteStatus {
  const [auditReleased, setAuditReleased] = useState(false);
  const [registrationState, setRegistrationState] = useState<unknown>(undefined);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    const encoded = encodeURIComponent(slug);
    fetch(`/api/public/tournaments/${encoded}/audit?status=public`)
      .then((response) => {
        if (active) setAuditReleased(response.ok);
      })
      .catch((error: unknown) => console.warn("Could not check the public audit log:", error));
    fetch(`/api/public/tournaments/${encoded}/registration`)
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { form?: { state?: unknown } };
        if (active) setRegistrationState(result.form?.state);
      })
      .catch((error: unknown) => console.warn("Could not check the registration form:", error));
    return () => {
      active = false;
    };
  }, [slug]);

  return { auditReleased, registrationState };
}
