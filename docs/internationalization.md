# Internationalization (UI languages)

CrabbyTab's interface can be shown in more than one language. English is the
source language. Bengali (বাংলা) ships as a working second language. Its
catalogue was **machine-drafted** and still needs review by a fluent speaker.

Only part of the app is translated so far: the public pages and the private
portals. See [What is translated](#what-is-translated).

## How it works

CrabbyTab uses a small typed dictionary in `src/lib/i18n/` instead of a
library such as next-intl. The reasons:

- **Offline first.** Every catalogue is a TypeScript module bundled with the
  app, so switching language never needs the network. That includes a
  portal that was cached for offline use.
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
| `src/lib/i18n/messages/<code>.ts` | One catalogue per language. Missing keys fall back to English. |
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
3. **The browser's languages** (`navigator.languages`), in order. A regional
   tag such as `bn-BD` matches `bn`.
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

1. Add the key to `src/lib/i18n/messages/en.ts`. Name it `area.subject`, for
   example `teamPortal.emptyTitle`. Use `common.*` only for words that mean
   the same thing everywhere.
2. In the component, call `const { t } = useI18n();` and render
   `{t("teamPortal.emptyTitle")}`. Keys are type-checked, so a typo fails the
   build.
3. Add the same key to every other catalogue. `npm test` fails until you do
   (see [Tests](#tests)). If you cannot translate it yet, copy the English
   text and mention it in the pull request. A missing key still falls back to
   English at runtime.

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

1. Add an entry to `LOCALES` in `src/lib/i18n/config.ts`:
   ```ts
   { code: "es", nativeName: "Español", englishName: "Spanish", intlLocale: "es", machineDrafted: true },
   ```
   Use a BCP 47 primary language code. Add a region (`pt-BR`) only if you
   ship regional variants.
2. Create `src/lib/i18n/messages/es.ts` exporting `const es: Catalogue = { ... }`.
   Copy the keys from `en.ts`.
3. Register the catalogue in `src/lib/i18n/messages/index.ts`.
4. Run `npm test`. The catalogue test lists every missing key, unknown key,
   missing plural category, and placeholder or markup mismatch.
5. Check the public page and both portals in the new language. Look at long
   words in buttons and table headers, and at RTL layout if it applies.

The language then appears in the switcher and in the tournament
public-language setting. It is also matched against browser preferences.

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
- `src/lib/i18n/translate.test.ts` covers interpolation, fallback, plurals,
  rich text and formatting.

## What is translated

Translated:

- The public tournament page (`/[slug]/public`) and its participant,
  institution, adjudicator and motion-statistics panels
- Public check-in counts (`/[slug]/checkins/public`) and the public audit log
  (`/[slug]/audit/public`)
- The team and adjudicator private portals, including the passcode screen,
  self check-in, feedback forms, tournament feedback questions and in-portal
  ballot entry
- The language menu in the staff account menu
- Tab-room pages (`tabroom.*`): draw, allocation, preformed panels, admin
  check-ins, and the printable ballots and feedback sheets. Printed sheets use
  the tournament's public language (`usePrintTranslator`), whatever language
  the tab director's screen is in. Draw-check issues, allocator warnings and
  venue/clash reasons from `src/lib/**` are still English.

Not translated yet (English only):

- The staff tournament admin: navbar, sidebar, draw, allocation, results,
  standings, breaks, settings, imports, check-ins, feedback review, email,
  private URLs, audit and analytics
- The home, login and forgot-password pages, the tournament list, and the
  setup wizard and import pages
- The projector display (`/[slug]/display`) and printable ballots and
  feedback sheets
- Messages from shared code that the portals show as they are: score
  validation (`src/lib/scoring/validator.ts`), feedback-question validation
  (`src/lib/feedback/questions.ts`), sync and server errors from
  `TournamentContext` and the API routes, and offline banners
  (`OfflineSupport`)
- Email notifications and the `<title>`/metadata in `src/app/layout.tsx`
