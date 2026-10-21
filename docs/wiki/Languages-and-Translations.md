# Languages and translations

CrabbyTab's interface can be shown in 26 languages: English and every language Tabbycat v2.12.1
offers. Each person picks their own language. You can also set a default language for your
tournament's public pages and participant portals.

**Every language except English is machine-drafted.** No fluent speaker has reviewed those
translations yet. The language menu marks each one "Machine-drafted translation". If you run a
tournament in one of these languages, check the pages your participants will see first, and
consider [reviewing the catalogue](#reviewing-a-translation).

Full developer reference:
[docs/internationalization.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/internationalization.md).

## Supported languages

| Code | Language | Native name | Direction | Status |
| --- | --- | --- | --- | --- |
| `en` | English | English | Left to right | Source language |
| `ar` | Arabic | العربية | **Right to left** | Machine-drafted |
| `ast` | Asturian | Asturianu | Left to right | Machine-drafted |
| `bn` | Bengali | বাংলা | Left to right | Machine-drafted |
| `bg` | Bulgarian | Български | Left to right | Machine-drafted |
| `ca` | Catalan | Català | Left to right | Machine-drafted |
| `cs` | Czech | Čeština | Left to right | Machine-drafted |
| `de` | German | Deutsch | Left to right | Machine-drafted |
| `el` | Greek | Ελληνικά | Left to right | Machine-drafted |
| `es` | Spanish | Español | Left to right | Machine-drafted |
| `fr` | French | Français | Left to right | Machine-drafted |
| `he` | Hebrew | עברית | **Right to left** | Machine-drafted |
| `hi` | Hindi | हिन्दी | Left to right | Machine-drafted |
| `id` | Indonesian | Bahasa Indonesia | Left to right | Machine-drafted |
| `it` | Italian | Italiano | Left to right | Machine-drafted |
| `ja` | Japanese | 日本語 | Left to right | Machine-drafted |
| `kk` | Kazakh | Қазақ тілі | Left to right | Machine-drafted |
| `ms` | Malay | Bahasa Melayu | Left to right | Machine-drafted |
| `pt` | Portuguese | Português | Left to right | Machine-drafted |
| `ro` | Romanian | Română | Left to right | Machine-drafted |
| `ru` | Russian | Русский | Left to right | Machine-drafted |
| `sk` | Slovak | Slovenčina | Left to right | Machine-drafted |
| `tr` | Turkish | Türkçe | Left to right | Machine-drafted |
| `uk` | Ukrainian | Українська | Left to right | Machine-drafted |
| `vi` | Vietnamese | Tiếng Việt | Left to right | Machine-drafted |
| `zh-Hans` | Simplified Chinese | 简体中文 | Left to right | Machine-drafted |

Notes:

- Debate terms follow Tabbycat's own translation for that language where it has one. Where
  Tabbycat's term was missing or clearly wrong (for example Italian "Bye" translated as "Ciao"),
  the drafter chose a term.
- Portuguese uses the Brazilian wording of Tabbycat's `pt` catalogue.
- Arabic, Bengali and Hindi show scores, ranks and other numbers with Latin digits (0–9), so they
  match paper ballots. Month and day names are still localised.
- There is no Traditional Chinese. A browser set to Traditional Chinese (`zh-TW`, `zh-HK`,
  `zh-Hant`) gets English rather than Simplified characters.

## Choosing a language

### For yourself

- **Staff pages:** open the **account menu** (top right of the navbar). The **Language** section
  lists every language plus **Automatic**.
- **Public pages, portals, public registration, the home page, the tournament list and the setup
  wizard:** use the **language button** in the page header. (The sign-in page has no button; it
  uses your saved choice or browser language.) It shows the current language's own name (for example "Deutsch"), so a reader who cannot
  read the current language can still find it.

Your choice is saved **in this browser only** (`localStorage`), not in your account. It does not
follow you to another device. Choose **Automatic** to clear it.

### For your tournament's participants

Participants often leave their browser in English even when the tournament runs in another
language. To set a default for them:

1. In the sidebar, go to **Admin → Configuration → Public visibility**.
2. Set **Public pages and portals language**. "Each viewer's browser language" (the default) means
   no tournament language.
3. Save tournament settings.

The tournament language applies to:

- the public tab and its sub-pages (records, schedule, check-ins, audit log, public ballot and
  feedback forms),
- the team and adjudicator private-URL portals,
- the projector display (`/{slug}/display`),
- printed ballots and feedback forms (see below).

It does **not** apply to staff pages, which always use each staff member's own choice. It also
does not apply to public registration (`/register/{slug}`), which uses the viewer's own choice or
browser language.

**Printed ballots and feedback sheets** are printed in the tournament's public language, whatever
language your own screen is in. The print options show "Sheets print in {language}, the
tournament's public language." If no tournament language is set, they print in your own language.

### Which language wins

CrabbyTab uses the first of these that matches a supported language:

1. The viewer's own choice in the language menu.
2. The tournament's public language (public pages, portals and projector only).
3. The browser's preferred languages, in order. Regional tags are matched to the base language:
   `bn-BD` → Bengali, `pt-BR` → Portuguese, `zh-CN` → Simplified Chinese.
4. English.

The language is **never** in the URL and is not stored in a cookie. Private URLs, QR codes and
printed links work the same in every language.

## Right-to-left languages

Arabic and Hebrew pages are laid out right to left: the page mirrors, and directional icons
(arrows, chevrons) flip. The direction is set before the page first appears, so it never flashes
left to right. Any right-to-left language added later (Persian, Urdu, and so on) gets this
automatically.

## What is translated

Translated:

- Public pages, public forms and public registration.
- Team and adjudicator portals, including check-in, feedback and ballot entry.
- Almost all staff pages: draw, allocation, results, standings, breaks, feedback, motions,
  settings, imports and exports, backups, staff access, email setup, private URLs, schedule and
  the projector.
- Home, sign-in, the tournament list, the setup wizard and the API reference text.
- Long side names (for example "Opening Government"). Short side codes (OG, OO, CG, CO, AFF, NEG)
  stay as codes in every language.

**Never translated** — anything you or participants type in, or anything saved into records:

- team, speaker, institution, adjudicator, venue and round names,
- motions and info slides,
- feedback questions and answers,
- audit log summaries,
- CSV imports and exports (headers and values).

**Still English** (not yet translated):

- Warnings and validation messages produced by shared logic: draw-check issues, allocator
  warnings, venue and clash reasons, rule violations, score validation, backup validation, sync
  and upload status, and why a public release is blocked.
- Error messages from the server and the REST API, and the OpenAPI document.
- Emails (campaigns and automatic notifications).
- Browser tab titles and page metadata.

## Gotchas

- **Offline:** a language you have never opened before cannot load while offline. The page stays
  in English until you are back online. A language you have opened once keeps working offline.
- **First moment of a page load:** the page renders in English and switches as soon as the
  language loads. Most pages show a loading state at that time, so this is rarely visible.
- **Machine-drafted wording:** treat unusual debate terms as a translation issue, not a rule
  difference. Report them (see below).

## Reviewing a translation

If you are fluent in one of the languages, a review is the most useful contribution you can make.

1. Find the catalogue: `src/lib/i18n/messages/locales/<code>.json` (Bengali is split across
   `src/lib/i18n/messages/bn.ts` and the `src/lib/i18n/messages/areas/bn-*` files). Each key's
   English text is in `src/lib/i18n/messages/en.ts` and `src/lib/i18n/messages/areas/`.
2. Switch CrabbyTab to the language and walk through the public tab, both portals and the pages
   you use most. Look for wrong debate terms, unnatural wording, and text too long for buttons
   or table headers.
3. Edit the values only. Keep the following exactly as in English:
   - `{placeholders}` such as `{round}` or `{count}`,
   - `<tag>…</tag>` markup such as `<b>this portal</b>`,
   - plural keys (`_one`, `_few`, `_many`, `_other`, …) — the language needs every category it has,
   - product names (CrabbyTab, Tabbycat, CSV, API).
4. Run `npm run i18n:check` (see below).
5. After the **whole** file has been reviewed, remove `machineDrafted: true` from that language's
   entry in `LOCALES` (`src/lib/i18n/config.ts`) in the same pull request. The "machine-drafted"
   labels then disappear. For Bengali, also remove the machine-drafted warning comment at the top
   of `bn.ts`.

Partial reviews are welcome too; leave the flag on and say what you covered in the pull request.
See [Contributing](Contributing).

## Details for contributors

### How it works

CrabbyTab uses a small in-house typed dictionary in `src/lib/i18n/` rather than an i18n library.
Translated pages are client components; a client-side provider (`I18nProvider`) chooses the
language with `resolveLocale` in `src/lib/i18n/config.ts`.

- **English** is bundled with every page and is the fallback: a missing key in any catalogue shows
  the English text.
- **Other catalogues are lazy-loaded.** Each is its own code-split chunk, fetched the first time
  that language is chosen and cached by the service worker afterwards. See `loadCatalogue` in
  `src/lib/i18n/messages/index.ts` and [Architecture](Architecture).
- **Keys are type-checked.** `t("some.key")` with a key not in the English catalogue fails the
  build.
- Plurals use `Intl.PluralRules`; numbers, dates and lists use the `Intl` formatters from
  `useI18n()`. Each language has an `intlLocale` tag (for example `ar-u-nu-latn` keeps Latin
  digits).

### Adding a language

1. Create the catalogue from the English source:
   ```bash
   npm run i18n:new -- sw
   ```
   This writes `src/lib/i18n/messages/locales/sw.json` with every English key (English text as the
   value to translate) and every plural category the language needs, worked out with
   `Intl.PluralRules` (extra categories start from the English `_other` text). The code must be a
   BCP 47 tag (`sw`, `pt-BR`). It refuses to overwrite an existing file unless `I18N_OVERWRITE=1`
   is set. It then prints the remaining steps.
2. Translate the values, following the rules in [Reviewing a translation](#reviewing-a-translation).
3. Add an entry to `LOCALES` in `src/lib/i18n/config.ts`:
   ```ts
   { code: "sw", nativeName: "Kiswahili", englishName: "Swahili", intlLocale: "sw", machineDrafted: true },
   ```
   Leave `machineDrafted: true` until a fluent speaker has reviewed it. Use an `intlLocale` such as
   `xx-u-nu-latn` if the language's default digits are not Latin. Right-to-left is detected from
   the code; nothing else to set.
4. Add a loader line in `src/lib/i18n/messages/index.ts` (a literal `import()` path, so the
   catalogue becomes its own chunk):
   ```ts
   sw: () => import("@/lib/i18n/messages/locales/sw.json").then(json),
   ```
5. Run `npm run i18n:check`.
6. Check the public tab, both portals and a few staff pages in the new language, including the
   right-to-left layout if it applies.

The language then appears in the language menu and the tournament public-language setting, and is
matched against browser preferences.

### Checking catalogues

`npm run i18n:check` runs the i18n tests (`vitest run src/lib/i18n`). It checks **every**
catalogue, not just one; a language code after it is ignored. It reports:

- missing and unknown keys,
- missing plural categories for the language,
- `{placeholder}` and `<tag>` markup that differs from English,
- locale matching, text direction and the pre-paint script (`config.test.ts`),
- lookup, fallback, plurals and formatting (`translate.test.ts`).

The same tests run in `npm test`, so a pull request that adds an English string must add the key
to every catalogue (copy the English text if you cannot translate it, and say so in the pull
request). See [Testing](Testing).

The two scripts live in `tools/i18n/` (`run.mjs`, `template.ts`, `newLanguage.test.ts`).

### Adding a new string

Add the key to the English catalogue for that area (`src/lib/i18n/messages/areas/…` or `en.ts`),
use it with `t()`, `plural()` or `rich()` from `useI18n()`, and add it to every other catalogue.
Never translate strings that are saved into records or compared in code. Full rules:
[docs/internationalization.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/internationalization.md#translating-a-new-string).

For right-to-left support in new components, use logical Tailwind utilities (`ms-*`/`me-*`,
`ps-*`/`pe-*`, `start-*`/`end-*`, `text-start`/`text-end`), `gap-*` instead of `space-x-*`, and
`rtl:-scale-x-100` on directional icons.
