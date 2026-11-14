"use client";

import React from "react";
import { Image as ImageIcon, Video, X } from "lucide-react";
import type { InfoSlideMedia } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Input } from "@/components/ui/Field";
import { InfoSlideMediaView } from "@/features/tournament/components/InfoSlideMediaView";
import { INFO_SLIDE_MEDIA_ALT_MAX_LENGTH, INFO_SLIDE_MEDIA_URL_MAX_LENGTH, normalizeInfoSlideMedia } from "@/lib/motions/infoSlideMedia";

/** The editor's working copy: the kind stays chosen while the link is still empty. */
export interface InfoSlideMediaDraft {
  kind: "none" | "image" | "video";
  url: string;
  alt: string;
}

export const EMPTY_INFO_SLIDE_MEDIA_DRAFT: InfoSlideMediaDraft = { kind: "none", url: "", alt: "" };

export function draftFromInfoSlideMedia(media: InfoSlideMedia | undefined): InfoSlideMediaDraft {
  return media ? { kind: media.kind, url: media.url, alt: media.alt ?? "" } : EMPTY_INFO_SLIDE_MEDIA_DRAFT;
}

/** The media to save, or `invalid` when the link is not one CrabbyTab can show. */
export function infoSlideMediaFromDraft(draft: InfoSlideMediaDraft): { ok: true; media: InfoSlideMedia | undefined } | { ok: false } {
  if (draft.kind === "none") return { ok: true, media: undefined };
  const result = normalizeInfoSlideMedia({ kind: draft.kind, url: draft.url, alt: draft.alt });
  return result.ok ? result : { ok: false };
}

/** Picture or video for a motion's info slide: kind, link, description, and a live preview. */
export function InfoSlideMediaFields({
  draft,
  onChange,
}: {
  draft: InfoSlideMediaDraft;
  onChange: (draft: InfoSlideMediaDraft) => void;
}) {
  const { t } = useI18n();
  const parsed = infoSlideMediaFromDraft(draft);
  const invalid = draft.kind !== "none" && Boolean(draft.url.trim()) && !parsed.ok;
  const error = invalid
    ? t(draft.kind === "image" ? "setup.importsExtra.motions.mediaInvalidImage" : "setup.importsExtra.motions.mediaInvalidVideo")
    : undefined;

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 block text-xs font-medium text-fg">{t("setup.importsExtra.motions.mediaLabel")}</legend>
      <SegmentedControl
        label={t("setup.importsExtra.motions.mediaLabel")}
        size="sm"
        value={draft.kind}
        onChange={(kind) => onChange({ ...draft, kind })}
        options={[
          { value: "none", label: t("setup.importsExtra.motions.mediaNone"), icon: <X aria-hidden="true" /> },
          { value: "image", label: t("setup.importsExtra.motions.mediaImage"), icon: <ImageIcon aria-hidden="true" /> },
          { value: "video", label: t("setup.importsExtra.motions.mediaVideo"), icon: <Video aria-hidden="true" /> },
        ]}
      />
      {draft.kind !== "none" && (
        <>
          <Input
            label={t("setup.importsExtra.motions.mediaUrlLabel")}
            help={t(draft.kind === "image" ? "setup.importsExtra.motions.mediaImageHelp" : "setup.importsExtra.motions.mediaVideoHelp")}
            type="url"
            inputMode="url"
            maxLength={INFO_SLIDE_MEDIA_URL_MAX_LENGTH}
            placeholder="https://"
            value={draft.url}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
            error={error}
          />
          <Input
            label={t("setup.importsExtra.motions.mediaAltLabel")}
            help={t("setup.importsExtra.motions.mediaAltHelp")}
            maxLength={INFO_SLIDE_MEDIA_ALT_MAX_LENGTH}
            value={draft.alt}
            onChange={(event) => onChange({ ...draft, alt: event.target.value })}
          />
          {parsed.ok && parsed.media && <InfoSlideMediaView media={parsed.media} size="sm" />}
        </>
      )}
    </fieldset>
  );
}
