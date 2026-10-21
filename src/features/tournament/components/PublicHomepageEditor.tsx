"use client";

import React, { useDeferredValue, useId } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LazyMarkdown } from "@/components/markdown/LazyMarkdown";
import { Textarea } from "@/components/ui/Field";
import type { MessageKey } from "@/lib/i18n/messages";
import { PUBLIC_HOMEPAGE_MAX_LENGTH } from "@/lib/publicFeatures";

/** Syntax examples (Markdown itself, never translated) and what each one does. */
const SYNTAX_HELP: ReadonlyArray<readonly [string, MessageKey]> = [
  ["## Heading  **bold**  *italic*  ~~struck~~  - list  - [ ] task  > quote", "setup.config.homepageSyntaxText"],
  ["[Schedule](https://example.org/schedule)", "setup.config.homepageSyntaxLink"],
  ["![Venue map](https://example.org/map.png)", "setup.config.homepageSyntaxImage"],
  ["$E = mc^2$   $$\\sum_{i=1}^n i$$", "setup.config.homepageSyntaxMath"],
  ["https://youtu.be/VIDEO_ID   @[youtube](https://youtu.be/VIDEO_ID?t=90)", "setup.config.homepageSyntaxVideo"],
  ["| Round | Time |\n| --- | --- |\n| R1 | 09:00 |", "setup.config.homepageSyntaxTable"],
];

/**
 * The public homepage editor (Configuration → Public visibility): Markdown with a live preview
 * rendered by the same safe renderer as the public Home tab. The preview is deferred so typing
 * stays responsive on long pages.
 */
export function PublicHomepageEditor({ value, onChange }: { value: string; onChange: (value: string | undefined) => void }) {
  const { t } = useI18n();
  const preview = useDeferredValue(value);
  const previewHeadingId = useId();
  const tooLong = value.length > PUBLIC_HOMEPAGE_MAX_LENGTH;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Textarea
            label={t("setup.config.homepageLabel")}
            rows={16}
            maxLength={PUBLIC_HOMEPAGE_MAX_LENGTH}
            className="font-mono text-xs leading-relaxed"
            value={value}
            onChange={(event) => onChange(event.target.value || undefined)}
            help={t("setup.config.homepageHelp")}
            error={tooLong ? t("setup.config.homepageTooLong", { max: PUBLIC_HOMEPAGE_MAX_LENGTH }) : undefined}
            spellCheck
          />
          <p className="text-end text-[11px] tabular-nums text-fg-muted">
            {t("setup.config.homepageCount", { count: value.length, max: PUBLIC_HOMEPAGE_MAX_LENGTH })}
          </p>
        </div>
        <section aria-labelledby={previewHeadingId} className="min-w-0 space-y-1.5">
          <h4 id={previewHeadingId} className="text-[13px] font-medium text-fg">
            {t("setup.config.homepagePreview")}
          </h4>
          <div className="max-h-[32rem] overflow-y-auto rounded-md border border-border bg-surface p-4">
            {preview.trim() ? (
              <LazyMarkdown source={preview} videoTitle={t("public.home.videoTitle")} />
            ) : (
              <p className="text-xs text-fg-muted">{t("setup.config.homepagePreviewEmpty")}</p>
            )}
          </div>
        </section>
      </div>
      <details className="rounded-md border border-border bg-muted px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-fg">{t("setup.config.homepageSyntaxTitle")}</summary>
        <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {SYNTAX_HELP.map(([example, description]) => (
            <div key={description} className="contents">
              <dt>
                <code className="block whitespace-pre-wrap break-words rounded-sm bg-surface px-1.5 py-1 font-mono text-[11px] text-fg" dir="ltr">
                  {example}
                </code>
              </dt>
              <dd className="text-fg-muted">{t(description)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-fg-muted">{t("setup.config.homepageSyntaxHtml")}</p>
      </details>
    </div>
  );
}
