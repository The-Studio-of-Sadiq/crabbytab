"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isSlugUsedOnDevice, saveImportedTournamentLocally } from "@/features/tournament/application/importedTournamentStorage";
import { randomSeed } from "@/lib/draw/rng";
import { getLocalStore } from "@/lib/offline/localStore";
import { buildDemoTournament, DEMO_SLUG_PREFIX, type DemoFormat } from "@/lib/rehearsal/demoTournament";
import { validateSlug } from "@/lib/setup/presets";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Creates a demo tournament on this device for rehearsals and training. Like the DebateXML
 * import it creates a new local tournament only (never overwriting one) and needs a global
 * administrator, the same rule as creating any tournament.
 */
export function DemoTournamentForm() {
  const router = useRouter();
  const { user, isGlobalAdmin, loading: authLoading } = useAuth();
  const { t, rich } = useI18n();
  const [format, setFormat] = useState<DemoFormat>("bp");
  const [slug, setSlug] = useState(() => `${DEMO_SLUG_PREFIX}bp-${randomSeed() % 10000}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (authLoading) return <p role="status" className="text-[13px] text-fg-muted">{t("setup.entry.checkingAccess")}</p>;
  if (!isGlobalAdmin) {
    return (
      <Alert tone="warning" role="alert">
        {t("setup.entry.demo.adminOnly")}
      </Alert>
    );
  }

  const changeFormat = (next: DemoFormat) => {
    setFormat(next);
    if (/^demo-(bp|wsdc)-\d+$/.test(slug)) setSlug(`${DEMO_SLUG_PREFIX}${next}-${randomSeed() % 10000}`);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const slugError = validateSlug(slug) || (slug.startsWith(DEMO_SLUG_PREFIX) ? "" : t("setup.entry.demo.slugPrefix", { prefix: DEMO_SLUG_PREFIX }));
    if (slugError) {
      setError(slugError);
      return;
    }
    setBusy(true);
    try {
      if (await isSlugUsedOnDevice(getLocalStore(), slug)) {
        throw new Error(t("setup.entry.slugExists", { slug }));
      }
      const demo = buildDemoTournament({ format, slug, ownerId: user?.uid || "local", seed: randomSeed() });
      await saveImportedTournamentLocally(getLocalStore(), demo);
      router.push(`/${slug}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("setup.entry.demo.createFailed"));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
            {t("setup.entry.demo.title")}
          </span>
        }
        description={rich("setup.entry.demo.intro", {
          b: (text) => <strong className="font-semibold text-fg">{text}</strong>,
          code: (text) => <span className="font-mono">{text}</span>,
        })}
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t("setup.entry.demo.formatLabel")}
              value={format}
              onChange={(event) => changeFormat(event.target.value as DemoFormat)}
            >
              <option value="bp">{t("setup.entry.demo.formatBp")}</option>
              <option value="wsdc">{t("setup.entry.demo.formatWsdc")}</option>
            </Select>
            <Input
              label={t("setup.entry.slugLabel")}
              help={t("setup.entry.demo.slugHelp", { slug: slug || "…" })}
              value={slug}
              onChange={(event) => setSlug(event.target.value.trim().toLowerCase())}
              className="font-mono"
            />
          </div>
          {/* Slug rule messages come from validateSlug (src/lib/setup/presets) and are English for now. */}
          {error && <Alert tone="danger" role="alert">{error}</Alert>}
          <Button type="submit" variant="primary" loading={busy} loadingText={t("setup.entry.demo.creating")}>
            {t("setup.entry.demo.submit")}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
