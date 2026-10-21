# Public homepage (Home tab)

Every tournament's public page (`/your-slug/public`) opens on a **Home** tab. Write it once in CrabbyTab and you have an event website: an about section, the schedule at a glance, rules and motions info, prizes, venue directions with pictures, a welcome video, maths for scoring rules, and a **Register** button while registration is open. You do not need a separate site.

## Where to edit it

1. Sidebar → **Admin → Configuration → Public visibility**.
2. Find **Public homepage**. Type Markdown in the box on the left; the **preview** next to it shows exactly what visitors will see. **Syntax help** (below the box) lists everything you can use.
3. Press **Save**. Like every public-page setting, this saves on your device first: press **Upload and publish** in the notice that appears (or **Upload now** in the top bar). The public page updates within about a minute.

Limits: up to 20,000 characters. The text is shown as written in every language; it is not translated.

## What visitors see

- The Home tab is the first tab and the one the page opens on. Other tabs (draw, results, tab, motions, break…) appear as you release them. A link such as `/your-slug/public?tab=draw` opens a specific tab.
- If the homepage is empty, the Home tab shows the older **Welcome message** instead (plain text), so existing tournaments keep working.
- The **tournament staff** credits (also on Public visibility) are shown on the Home tab.
- While registration is **open** (Registration page), a prominent **Register** button links to the registration form. It disappears automatically when registration closes.
- Links to the public schedule and calendar, check-in status and audit log appear when those are switched on.
- The first paragraph of the homepage becomes the description shown in search results and link previews (WhatsApp, Facebook, Slack, X…), so make it a good one-sentence summary.

## Syntax cheat-sheet

| You want | Type |
| --- | --- |
| Heading | `## Schedule` (one `#` is fine too; headings sit under the tournament name) |
| Bold / italic / strikethrough | `**bold**`, `*italic*`, `~~struck~~` |
| Link | `[Rules PDF](https://example.org/rules.pdf)` or just paste `https://…` |
| Email link | `[Write to us](mailto:tab@example.org)` |
| Image | `![Venue map](https://example.org/map.png)` (must be an **https** link; the text in brackets is the alt text for screen readers) |
| YouTube video | Paste the YouTube link **alone on its own line**, or `@[youtube](https://youtu.be/VIDEO_ID)`. Watch, youtu.be, Shorts and embed links work; `?t=90` starts at 90 seconds. |
| Bullet / numbered list | `- item` / `1. item` |
| Checklist | `- [x] Venue booked` / `- [ ] Judges confirmed` |
| Table | `| Day | Event |` then `| --- | --- |` then rows |
| Quote | `> Debate is the art of…` |
| Code | `` `inline` `` or a block fenced with three backticks |
| Divider | `---` on its own line |
| Inline maths | `$\frac{a}{b}$` |
| Display maths | `$$` on a line, the formula, `$$` on a line |
| A literal dollar sign | `\$500 prize` (a plain `$` starts maths) |

### Example

```markdown
## Welcome to the Dhaka Open 2026

Three days of BP debating at the University of Dhaka, 14–16 November.
Registration closes on **1 November**.

@[youtube](https://youtu.be/dQw4w9WgXcQ)

### Schedule
| Day | |
| --- | --- |
| Friday | Rounds 1–3 |
| Saturday | Rounds 4–5, break night |
| Sunday | Quarters, semis, grand final |

### Prizes
- Champions: \$500
- Best speaker: \$100

Speaker scores are averaged as $\bar{s} = \frac{1}{n}\sum_{i=1}^{n} s_i$.

![Campus map](https://example.org/campus-map.png)

Questions? [Email the tab team](mailto:tab@example.org).
```

## What is not allowed (and why)

The homepage is public, so CrabbyTab only renders safe content:

- **No HTML.** Tags such as `<div>`, `<script>`, `<iframe>` or `<style>` are dropped, not shown. Use Markdown instead.
- **Images** must use `https://` links. Upload them somewhere public first (your university site, an image host, Google Drive "anyone with the link" direct links, etc.). Images load lazily and without sending your page address to the image host.
- **Links** may be `https://`, `http://`, `mailto:` or a path on the same site (`/your-slug/public?tab=draw`). Other kinds (for example `javascript:`) are removed and only the text remains. Links open in a new tab and are marked `nofollow`.
- **Videos**: only YouTube, through its privacy-enhanced domain (`youtube-nocookie.com`), in a sandboxed frame. Other video sites are shown as ordinary links.
- **Maths** is rendered by KaTeX with untrusted-input settings: commands that create links or HTML (`\href`, `\url`, `\htmlClass`…) are disabled, and very large or deeply nested formulas show an error instead of slowing the page.

## Tips

- Keep the first paragraph short: it is your search-result and link-preview text.
- Put dates, the venue and the registration deadline near the top. The **Register** button appears on its own, so you do not need to add a registration link.
- The homepage does not change when rounds are released; update it yourself for announcements (for example "Break announced: see the Break tab").
- Use the **Search engines** setting on the same page if you do not want the tournament listed by search engines.

## Details

- Stored as the `publicHomepage` tournament setting (Markdown text), included in settings export/import and validated by the REST API's preferences endpoint.
- Published with the tournament's public snapshot, like every other public setting; visitors never read Firestore directly. See [Caching, indexing and performance](Caching-Indexing-and-Performance).
- The renderer (Markdown, KaTeX and their styles) is loaded only on the Home tab and in the editor preview, so other pages stay light.
- Developer notes: `src/components/markdown/` (renderer), `src/lib/markdown/` (URL rules, YouTube parsing, plain-text summary), and the "Public homepage" section of [`docs/public-pages-and-notifications.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md).

See also: [Public pages and releases](Public-Pages-and-Releases) · [Registration](Participants-and-Imports) · [Settings reference](Settings-Reference).
