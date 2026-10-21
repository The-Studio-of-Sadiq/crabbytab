# CrabbyTab website (GitHub Pages)

This folder builds the static site published at
`https://the-studio-of-sadiq.github.io/crabbytab/`:

- `src/index.html` — the landing page, with `src/assets/site.css` (shared styles, light and
  dark via `prefers-color-scheme`) and `src/assets/guide.js` (guide navigation and search).
  `src/404.html` uses root paths under `/crabbytab/` because GitHub Pages serves it at any depth.
- `build.mjs` — copies `src/` to `dist/` and renders every `docs/wiki/*.md` page to
  `dist/guide/<Page-Name>.html`.

The site has no framework and no runtime dependencies. The app's logo and social image are copied
from `public/` at build time.

## What the build does

- Uses `_Sidebar.md` for the navigation and its link order for previous/next. Pages missing from
  the sidebar are listed under "More pages" and come last in the previous/next order.
- Uses `_Footer.md` for the footer, and each page's first `# heading` as its title (the page name
  otherwise).
- Rewrites GitHub-wiki links (`[Text](Page-Name)`, `[Text](Page-Name#anchor)` and full
  `https://github.com/The-Studio-of-Sadiq/crabbytab/wiki/...` URLs) to `Page-Name.html`.
- Gives headings GitHub's anchor ids, so `#anchors` written for the wiki keep working.
- Escapes HTML in code blocks, and wraps tables so wide ones scroll inside their own box.
- Writes `dist/guide/search-index.json` (title, section headings and text of each page), which
  `guide.js` loads on first use of the search box.
- Checks every relative link and `#anchor` in the output and prints the broken ones. Run with
  `--strict` to make broken links fail the build. The published build does not use `--strict`,
  so a wiki edit in progress cannot block publishing; check the log.

## Build locally

You need Node.js 20 or later. `marked` is a build-time tool and is **not** in the app's
`package.json`. Install it into a throwaway folder (the repository's `scratch-tmp/` is not
tracked) and point `MARKED_DIR` at it:

```sh
npm install --no-save --prefix scratch-tmp/marked marked@17.0.6
MARKED_DIR=scratch-tmp/marked node site/build.mjs
```

On Windows PowerShell:

```powershell
npm install --no-save --prefix scratch-tmp/marked marked@17.0.6
$env:MARKED_DIR = "scratch-tmp/marked"; node site/build.mjs
```

The output goes to `site/dist/` (ignored by Git). The guide's search loads a JSON file, which
browsers block for `file://` pages, so preview over HTTP:

```sh
MARKED_DIR=scratch-tmp/marked node site/build.mjs --serve
```

This builds and serves `site/dist` on <http://localhost:4173>.

## Publishing

`.github/workflows/pages.yml` runs on pushes to `main` or `beta` that change `docs/wiki/**`,
`site/**` or the workflow itself, and on manual runs (**Actions → Pages → Run workflow**). It:

1. installs `marked` (the version in the workflow's `MARKED_VERSION`) into a temporary folder,
2. runs `node site/build.mjs`,
3. force-pushes `site/dist` (with a `.nojekyll` file) as a single orphan commit to the
   `gh-pages` branch, using the built-in `GITHUB_TOKEN`,
4. if a `WIKI_TOKEN` secret exists, copies `docs/wiki/*.md` into the repository's GitHub wiki.
   Without that secret the step is skipped. Pages are added or updated, never deleted.

Both branches publish to the same `gh-pages` branch, so the most recent run wins.

One-time setup:

- **Settings → Pages:** source "Deploy from a branch", branch `gh-pages`, folder `/ (root)`.
- **Wiki sync (optional):** create the wiki's first page once in the GitHub UI (the wiki
  repository does not exist until then), then add a `WIKI_TOKEN` repository secret: a
  fine-grained personal access token for this repository with **Contents: read and write**
  (`GITHUB_TOKEN` cannot push to wikis).
