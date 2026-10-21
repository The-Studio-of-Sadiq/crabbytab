"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicFormShell } from "@/components/public/PublicFormShell";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input } from "@/components/ui/Field";

interface InvitationView {
  teamName: string;
  institutionName?: string;
  speakers: number;
  maxSpeakers: number;
  speakerCategories: string[];
  speakerFields: Array<"phone" | "gender">;
  /** Absent from servers before the email switch: asked. */
  askEmail?: boolean;
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

/**
 * Team invitation (Tabbycat team Invitation; docs/registration.md): a speaker adds themselves to
 * the team the link was issued for. The token travels in the URL fragment, never to the server
 * in a URL; the server re-checks everything on submit.
 */
export default function TeamInvitationPage() {
  const params = useParams();
  const slug = String(params.slug ?? "");
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [honeypot, setHoneypot] = useState("");
  const startedAt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinedTeam, setJoinedTeam] = useState("");

  useEffect(() => {
    let active = true;
    const fragment = window.location.hash.replace(/^#/, "").trim();
    setToken(fragment);
    startedAt.current = Date.now();
    (async () => {
      try {
        if (!fragment) throw new Error(t("register.join.linkMissing"));
        const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/registration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "teamInvitation", token: fragment }),
          cache: "no-store",
        });
        const result = await readJson<{ invitation?: InvitationView }>(response);
        if (!response.ok || !result.invitation) throw new Error(result.error || t("register.join.loadFailed"));
        if (active) setInvitation(result.invitation);
      } catch (failure) {
        if (active) setLoadError(failure instanceof Error ? failure.message : t("register.join.loadFailed"));
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, t]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invitation || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "joinTeam",
          token,
          speaker: {
            name,
            ...(invitation.askEmail !== false ? { email } : {}),
            categories,
            ...(invitation.speakerFields.includes("phone") ? { phone } : {}),
            ...(invitation.speakerFields.includes("gender") ? { gender } : {}),
          },
          website: honeypot,
          startedAt: startedAt.current,
        }),
        cache: "no-store",
      });
      const result = await readJson<{ joined?: boolean; teamName?: string }>(response);
      if (!response.ok) throw new Error(result.error || t("register.join.failed"));
      setJoinedTeam(result.teamName ?? invitation.teamName);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("register.join.failed"));
    } finally {
      setBusy(false);
    }
  };

  const full = invitation !== null && invitation.speakers >= invitation.maxSpeakers;

  return (
    <PublicFormShell>
      <header className="mb-5 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          {invitation ? t("register.join.title", { team: invitation.teamName }) : t("register.join.titleFallback")}
        </h1>
        {invitation?.institutionName && <p className="text-[13px] text-fg-muted">{invitation.institutionName}</p>}
      </header>
      {loadError && <Alert tone="danger" role="alert">{loadError}</Alert>}
      {joinedTeam && (
        <Alert tone="success" role="status">{t("register.join.done", { team: joinedTeam })}</Alert>
      )}
      {invitation && !joinedTeam && (
        <Card>
          <CardHeader
            title={t("register.join.formTitle")}
            description={t("register.join.places", { count: invitation.speakers, max: invitation.maxSpeakers })}
          />
          <CardBody>
            {full ? (
              <Alert tone="info">{t("register.join.full")}</Alert>
            ) : (
              <form onSubmit={(event) => void submit(event)} className="space-y-3">
                <Input label={t("register.join.name")} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                {invitation.askEmail !== false && (
                  <Input label={t("register.join.email")} type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                )}
                {invitation.speakerFields.includes("phone") && (
                  <Input label={t("register.join.phone")} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
                )}
                {invitation.speakerFields.includes("gender") && (
                  <Input label={t("register.join.gender")} maxLength={40} value={gender} onChange={(event) => setGender(event.target.value)} />
                )}
                {invitation.speakerCategories.length > 0 && (
                  <fieldset className="space-y-1">
                    <legend className="text-xs font-medium text-fg">{t("register.join.categories")}</legend>
                    {invitation.speakerCategories.map((category) => (
                      <Checkbox
                        key={category}
                        label={category}
                        checked={categories.includes(category)}
                        onChange={(event) =>
                          setCategories((current) =>
                            event.target.checked ? [...current, category] : current.filter((item) => item !== category)
                          )
                        }
                      />
                    ))}
                  </fieldset>
                )}
                {/* Honeypot: hidden from people, filled by some bots. */}
                <div aria-hidden="true" className="hidden">
                  <label>
                    Website
                    <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
                  </label>
                </div>
                {error && <Alert tone="danger" role="alert">{error}</Alert>}
                <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
                  {t("register.join.submit")}
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      )}
    </PublicFormShell>
  );
}
