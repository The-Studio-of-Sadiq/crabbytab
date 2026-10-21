# Internationalization (UI languages)

CrabbyTab's interface can be shown in 26 languages: English (the source
language) and every language Tabbycat v2.12.1 offers (`settings.LANGUAGES`,
apart from its `tzl` test locale): Arabic, Asturian, Bengali, Bulgarian,
Catalan, Czech, German, Greek, Spanish, French, Hebrew, Hindi, Indonesian,
Italian, Japanese, Kazakh, Malay, Portuguese, Romanian, Russian, Slovak,
Turkish, Ukrainian, Vietnamese and Simplified Chinese. Arabic and Hebrew are
laid out right to left.

**Every catalogue other than English was machine-drafted** and still needs
review by a fluent speaker. Debate terms follow Tabbycat's own translation for
that language where it has one; where Tabbycat's translation was empty or
clearly wrong (for example Italian "Bye" → "Ciao"), the drafter chose a term
and the switcher shows the "machine-drafted" label. Portuguese follows the
Brazilian wording Tabbycat's `pt` catalogue uses.

The public pages, the private portals and almost every staff page are
translated. Messages produced by shared code in `src/lib/**`, server errors and
emails are still English. See [What is translated](#what-is-translated).

## How it works

CrabbyTab uses a small typed dictionary in `src/lib/i18n/` instead of a
library such as next-intl. The reasons:

- **Offline first, small first load.** English is bundled with every page
  as the fallback. Every other catalogue is its own code-split chunk
  (`loadCatalogue` in `src/lib/i18n/messages/index.ts`), fetched once when
  that language is chosen and then cached by the service worker with the
  rest of `/_next/static`, so it keeps working offline afterwards. A
  language never opened before cannot load offline; the page then stays in
  English (key by key fallback) and logs a warning.
- **No routing changes.** Library i18n for the App Router usually puts the
  locale in the URL (`/bn/...`) or reads it from a cookie on the server. A
  locale segment would break every existing private URL, QR code and printed
  ballot link. Reading a cookie would make the cached public pages dynamic.
  The translated pages are client components already, so a client-side
  provider is enough.
- **No new dependency.** Interpolation, plurals (`Intl.PluralRules`) and
  formatting (`Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.ListFormat`)
  are built into the browser. The rest is about 300 lines (see AGENTS.md §14).

| File | Role |
| --- | --- |
| `src/lib/i18n/config.ts` | `LOCALES`, text direction, locale matching and selection (`resolveLocale`), and the pre-paint `localeInitScript` |
| `src/lib/i18n/messages/en.ts` | English source catalogue. Every key is defined here. |
| `src/lib/i18n/messages/bn.ts`, `messages/locales/<code>.json` | One catalogue per language (Bengali as TypeScript, the others as JSON), loaded on demand. Missing keys fall back to English. |
| `src/lib/i18n/translate.ts` | Lookup, `{placeholder}` interpolation, plurals and `<tag>` rich text |
| `src/lib/i18n/format.ts` | Cached `Intl` formatters for numbers, decimals, dates and lists |
| `src/components/i18n/I18nProvider.tsx` | `I18nProvider`, `useI18n()` and `useTournamentLocale()` |
| `src/components/ui/LanguageSwitcher.tsx` | `LanguageSwitcher` button and `LanguageMenuItems` for existing menus |

### Which language is shown

`resolveLocale` uses the first of these that matches a supported language:

1. **The viewer's own choice**, saved in `localStorage["crabbytab:locale"]`.
   Choosing "Automatic" in the switcher clears it.
2. **The tournament's public language** (`preferences.publicLanguage`). It
   applies only on public pages and private portals. Organisers set it in
   "Public pages and portals language" under Settings → Public visibility
   (`/[slug]/config/visibility`). Participants often leave their browser in
   English even when a tournament runs in another language, so the
   organiser's choice comes before the browser.
3. **The browser's languages** (`navigator.languages`), in order. Trailing
   subtags are dropped until one matches: `bn-BD` → `bn`, `pt-BR` → `pt`,
   `zh-Hans-CN` → `zh-Hans`; `zh` and `zh-CN`/`zh-SG` also match Simplified
   Chinese. Traditional Chinese tags (`zh-TW`, `zh-HK`, `zh-Hant`) match
   nothing rather than showing Simplified characters.
4. **English.**

### `lang`, `dir` and the first paint

The server cannot read `localStorage`, so the server render and the first
client render are in English. `localeInitScript` runs in `<head>` before
first paint and sets `<html lang dir>` from the saved choice or the browser.
This means a right-to-left page is never laid out left-to-right for a frame.
After hydration, the provider switches the text and keeps `lang`/`dir` up to
date, including when a tournament's public language loads. These pages
already show a loading state while tournament data loads, so the switch from
English is rarely visible.

`dir` comes from the primary language subtag (`textDirection`). Arabic,
Hebrew, Persian, Urdu and other right-to-left languages get `dir="rtl"` as
soon as they are added to `LOCALES`. No other code needs to change.

### Formatting

Use the formatters from `useI18n()` instead of `toFixed`, `toLocaleString`
or `join(", ")`:

| Instead of | Use |
| --- | --- |
| `value.toFixed(2)` | `formatDecimal(value, 2)` |
| `n.toLocaleString()` | `formatNumber(n)` |
| `new Date(x).toLocaleString()` | `formatDateTime(x)` (or `formatTime(x)`) |
| `names.join(", ")` | `formatList(names)` |

Numbers passed as message values are formatted automatically. Each locale
has an `intlLocale` tag. Bengali uses `bn-u-nu-latn`, which keeps Latin
digits (0–9) and Bengali month names. Speaker scores and ranks are checked
against paper ballots, so mixed digit systems would cause errors. Change the
tag if a tournament needs native digits.

## Translating a new string

1. Add the key to the English catalogue: the page area's own file
   (`src/lib/i18n/messages/areas/en-*.ts`, or its part under
   `areas/setup/*.en.ts` / `areas/tabroom/*.en.ts`, keys
   `setup.<part>.<subject>`, `tabroom.<part>.<subject>`), or
   `src/lib/i18n/messages/en.ts` for words shared across areas. Name it
   `area.subject`, for example `teamPortal.emptyTitle`. Use `common.*` only
   for words that mean the same thing everywhere.
2. In the component, call `const { t } = useI18n();` and render
   `{t("teamPortal.emptyTitle")}`. Keys are type-checked, so a typo fails the
   build.
3. Add the same key to every other catalogue (`bn` and each
   `locales/<code>.json`, with the plural categories each language needs).
   `npm test` fails until you do (see [Tests](#tests)). If you cannot
   translate it yet, copy the English text and mention it in the pull
   request. A missing key still falls back to English at runtime.

Message syntax:

- **Placeholders:** `"Check in for {round}"` → `t("checkIn.title", { round: name })`.
  Keep the whole sentence in one message. Do not join pieces with `+`,
  because word order differs between languages.
- **Plurals:** define `key_one` and `key_other` in English, plus whatever
  [CLDR categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
  the language needs (`_zero`, `_two`, `_few`, `_many`). Call
  `plural("portal.showing", count)`. `{count}` is provided for you.
- **Rich text:** wrap a span in a tag, `"Use <b>this portal</b> to vote"`,
  and render it with `rich("key", { b: (text) => <strong>{text}</strong> })`.
  Tags cannot be nested. Markup inside a value, such as a team named
  `<b>x</b>`, stays plain text.

Do **not** translate:

- Data entered by organisers: team, speaker, venue and round names, motions,
  feedback questions, and audit summaries.
- Strings that are **saved** to records, such as fallback names like
  `"Speaker 1"` written into a ballot. Saved data has to read the same for
  every viewer.
- Values compared in code, such as error messages matched with `===`.

Side codes (OG, OO, CG, CO, AFF, NEG) stay as codes, because tab rooms use
them in every language. Their long names (`side.OG` and so on) are
translated.

## Adding a language

1. Create the catalogue from the template:
   ```bash
   npm run i18n:new -- sw
   ```
   This writes `src/lib/i18n/messages/locales/sw.json` with every English key (English text as
   the value to translate) and every plural category the language needs, worked out with
   `Intl.PluralRules` (for example `_few` and `_many` for Russian). It refuses to overwrite an
   existing file unless `I18N_OVERWRITE=1` is set. Use a BCP 47 code; add a region (`pt-BR`)
   only for a regional variant.
2. Translate the values. Keep `{placeholders}` and `<tag>…</tag>` markup exactly as in English,
   follow the debate terms of Tabbycat's own translation for the language where one exists, and
   leave product names (CrabbyTab, Tabbycat, CSV, API…) untranslated.
3. Add an entry to `LOCALES` in `src/lib/i18n/config.ts`:
   ```ts
   { code: "sw", nativeName: "Kiswahili", englishName: "Swahili", intlLocale: "sw", machineDrafted: true },
   ```
   Use an `intlLocale` such as `xx-u-nu-latn` if the language's default digits are not Latin
   (scores are checked against paper ballots). Right-to-left is detected from the code.
4. Add a loader line in `src/lib/i18n/messages/index.ts` (a literal `import()` path, so the
   bundler makes the catalogue its own chunk):
   ```ts
   sw: () => import("@/lib/i18n/messages/locales/sw.json").then(json),
   ```
5. Check it:
   ```bash
   npm run i18n:check
   ```
   The catalogue test lists every missing key, unknown key, missing plural category, and
   placeholder or markup mismatch.
6. Look at the public page, both portals and a few staff pages in the new language: long words
   in buttons and table headers, and the right-to-left layout if it applies.

The language then appears in the switcher and in the tournament public-language setting, and is
matched against browser preferences.

When English strings are added later, `npm run i18n:check` reports the keys each catalogue is
missing; add them (translated) to every catalogue in the same pull request.

### Machine-drafted catalogues

Set `machineDrafted: true` when a catalogue has not been reviewed by a fluent
speaker. The switcher labels it "Machine-drafted translation", and the
setting shows "(machine-drafted)". After a fluent speaker has reviewed the
whole file, remove the flag and the warning comment at the top of the
catalogue in the same pull request.

## Right-to-left checklist

New and converted components should use logical Tailwind utilities so they
mirror correctly:

- `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`, `border-s`/`border-e`,
  `text-start`/`text-end`. Avoid `ml`/`mr`/`left`/`right`/`text-left`.
- Use `gap-*` in flex rows. `space-x-*` does not flip.
- Add `rtl:-scale-x-100` to directional icons such as chevrons and arrows.

## Tests

- `src/lib/i18n/catalogues.test.ts` checks that every catalogue has every
  English key, no unknown keys, every plural category the language needs,
  and the same placeholders and markup as English.
- `src/lib/i18n/config.test.ts` covers locale matching, the selection order,
  text direction and the pre-paint script.
- `src/lib/i18n/translate.test.ts` covers on-demand loading (English until a
  catalogue has loaded), interpolation, fallback, plurals, rich text and
  formatting.

## What is translated

Translated (the viewer's language unless noted):

- **Public pages:** the public tournament page (`/[slug]/public`) with its
  participant, institution, team and adjudicator record, motion-statistics
  and results panels; public check-ins, the public audit log, the public
  schedule, public ballot and feedback forms, and public registration
  (`/register/[slug]`). On the public tab, record pages and private portals the
  tournament's public language applies when the viewer has not chosen one;
  registration follows the viewer's own choice or browser language.
- **Private portals:** the team and adjudicator portals, including the
  passcode screen, self check-in, feedback forms, tournament feedback
  questions and in-portal ballot entry.
- **Staff pages:** the navbar, sidebar and sync menu; the tournament home;
  draw, allocation, preformed panels and check-ins; results, ballot entry and
  ballot intake; standings, breaks, feedback review, motions, analytics and
  the projector display (`/[slug]/display`); settings, imports, exports,
  backups and sync conflicts, staff and API access, email, private URLs,
  registration admin, audit log, schedule and rehearsal tools; shared
  dialogs (confirmations, rule overrides, public releases, the dialog close
  button, notifications and the theme menu).
- **Entry pages:** home, login and password reset, invitations, the
  tournament list, cross-tournament motion statistics, the setup wizard,
  tournament import and demo tournament pages, and the API reference text
  (`/tournaments/api`).
- **Printed ballots and feedback forms** use the tournament's public
  language (`usePrintTranslator`), whatever language the tab director's
  screen is in.

Still English:

- **Messages produced by shared code in `src/lib/**` and
  `src/features/**/application`**, which pages show as they are: draw-check
  issues, allocator warnings, venue and clash reasons, tournament-rule
  violations, score and feedback-question validation, backup validation
  issues, schedule-event validation, sync and upload status
  (`TournamentContext`), the record kinds in the sync-conflicts list, and the
  reasons a public release is blocked.
- **Server responses:** errors from the API routes (`src/app/api/**`) and
  the REST API, the OpenAPI document, and the route summaries and
  descriptions on the API reference page.
- **Emails** (campaigns and automatic notifications) and the
  `<title>`/metadata of pages (`src/app/layout.tsx`, the API reference).
- **Data entered by organisers or saved into records** (names, motions,
  feedback questions, audit summaries, CSV exports), which is never
  translated (see [Translating a new string](#translating-a-new-string)).
