"use client";

import React from "react";
import type { InfoSlideMedia } from "@/types";
import { cn } from "@/components/ui/cn";
import { useI18n } from "@/components/i18n/I18nProvider";
import { resolveInfoSlideMedia } from "@/lib/motions/infoSlideMedia";

/**
 * The picture or video of a motion's info slide. Only links `resolveInfoSlideMedia` accepts are
 * rendered: https images, youtube-nocookie embeds (sandboxed like the public homepage's) and https
 * video files; anything else renders nothing.
 */
export function InfoSlideMediaView({
  media,
  className,
  size = "md",
}: {
  media: InfoSlideMedia | undefined;
  className?: string;
  /** `lg` for the projector and presentation views, `sm` for list previews. */
  size?: "sm" | "md" | "lg";
}) {
  const { t } = useI18n();
  const source = resolveInfoSlideMedia(media);
  if (!source) return null;
  const frame = cn(
    "w-full overflow-hidden rounded-md border border-border bg-muted",
    size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-5xl" : "max-w-2xl",
    className
  );

  if (source.type === "image") {
    return (
      <figure className={frame}>
        {/* Organiser-hosted image on any https host, so next/image (fixed remote hosts) cannot serve it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={source.src}
          alt={source.alt || t("public.infoSlideMedia.imageAlt")}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn("mx-auto h-auto w-full object-contain", size === "lg" ? "max-h-[70vh]" : size === "sm" ? "max-h-48" : "max-h-[28rem]")}
        />
      </figure>
    );
  }

  const title = source.title || t("public.infoSlideMedia.videoTitle");
  return (
    <div className={frame}>
      {source.type === "youtube" ? (
        <div className="relative aspect-video w-full">
          <iframe
            src={source.src}
            title={title}
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            className="absolute inset-0 h-full w-full"
          />
        </div>
      ) : (
        <video
          src={source.src}
          title={title}
          aria-label={title}
          controls
          playsInline
          preload="metadata"
          className={cn("mx-auto w-full", size === "lg" ? "max-h-[70vh]" : size === "sm" ? "max-h-48" : "max-h-[28rem]")}
        />
      )}
    </div>
  );
}
