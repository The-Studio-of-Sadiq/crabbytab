#!/usr/bin/env node
// Builds the CrabbyTab GitHub Pages site into site/dist:
//   - copies the landing page and assets from site/src,
//   - renders every docs/wiki/*.md page to dist/guide/<Page-Name>.html,
//   - writes a small search index (dist/guide/search-index.json),
//   - checks that every internal link and #anchor in the output resolves.
//
// `marked` is NOT a project dependency. Install it somewhere outside the app's
// lockfile and point MARKED_DIR at that install prefix, e.g.
//   npm install --no-save --prefix scratch-tmp/marked marked@17.0.6
//   MARKED_DIR=scratch-tmp/marked node site/build.mjs
// Without MARKED_DIR the script falls back to a normal `import("marked")`.
//
// Flags: --strict  exit with status 1 when a broken internal link is found
//        --serve   after building, serve site/dist on http://localhost:4173

import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE_DIR, "..");
const SRC_DIR = path.join(SITE_DIR, "src");
const DIST_DIR = path.join(SITE_DIR, "dist");
const GUIDE_DIR = path.join(DIST_DIR, "guide");
const WIKI_DIR = path.join(ROOT, "docs", "wiki");
const REPO_URL = "https://github.com/The-Studio-of-Sadiq/crabbytab";
// Branch used for "view source" links; the workflow passes the branch it built.
const SOURCE_BRANCH = process.env.SITE_SOURCE_BRANCH || process.env.GITHUB_REF_NAME || "main";

const args = new Set(process.argv.slice(2));
const STRICT = args.has("--strict");
const SERVE = args.has("--serve");

// ---------------------------------------------------------------------------
// marked
// ---------------------------------------------------------------------------

async function loadMarked() {
  const dir = process.env.MARKED_DIR;
  if (dir) {
    const require = createRequire(path.join(path.resolve(dir), "noop.js"));
    let entry;
    try {
      entry = require.resolve("marked");
    } catch {
      throw new Error(`MARKED_DIR=${dir} does not contain node_modules/marked. Run: npm install --no-save --prefix ${dir} marked@17.0.6`);
    }
    return import(pathToFileURL(entry).href);
  }
  try {
    return await import("marked");
  } catch {
    throw new Error("Cannot find the `marked` package. See site/README.md: install it into a temporary folder and set MARKED_DIR.");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const decodeEntities = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** GitHub-style heading slug (what GitHub wikis use for #anchors). */
function githubSlug(text) {
  return decodeEntities(text)
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function pageTitleFromName(name) {
  return name.replace(/-/g, " ");
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function stripTags(html) {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Wiki pages
// ---------------------------------------------------------------------------

function readWiki() {
  if (!fs.existsSync(WIKI_DIR)) throw new Error(`No wiki folder at ${WIKI_DIR}`);
  const pages = new Map();
  let sidebar = "";
  let footer = "";
  for (const file of fs.readdirSync(WIKI_DIR).sort()) {
    if (!file.endsWith(".md")) continue;
    const name = file.slice(0, -3);
    const source = fs.readFileSync(path.join(WIKI_DIR, file), "utf8").replace(/^\uFEFF/, "");
    if (name === "_Sidebar") sidebar = source;
    else if (name === "_Footer") footer = source;
    else if (!name.startsWith("_")) pages.set(name, source);
  }
  if (!pages.size) throw new Error("docs/wiki contains no pages");
  return { pages, sidebar, footer };
}

/**
 * Resolves a GitHub-wiki link target ("Page-Name", "Page Name#anchor",
 * "https://github.com/<repo>/wiki/Page") to "<Page-Name>.html#anchor".
 * Returns null when the href is not a wiki link.
 */
function makeWikiResolver(pageNames) {
  const lower = new Map([...pageNames].map((n) => [n.toLowerCase(), n]));
  const wikiUrl = new RegExp(`^${REPO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wiki/?`, "i");
  const unresolved = [];
  function resolve(href, fromPage) {
    if (!href) return null;
    let target = href;
    if (wikiUrl.test(target)) target = target.replace(wikiUrl, "") || "Home";
    else if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\.)/i.test(target)) return null; // external, absolute, anchor or relative path
    const hashAt = target.indexOf("#");
    const pagePart = hashAt === -1 ? target : target.slice(0, hashAt);
    const anchor = hashAt === -1 ? "" : target.slice(hashAt);
    let name;
    try {
      name = decodeURIComponent(pagePart).replace(/\.md$/i, "").replace(/ /g, "-");
    } catch {
      name = pagePart;
    }
    if (!name) return null;
    const page = pageNames.has(name) ? name : lower.get(name.toLowerCase());
    if (!page) {
      unresolved.push({ from: fromPage, href });
      return `${encodeURI(name)}.html${anchor}`;
    }
    return `${page}.html${anchor}`;
  }
  return { resolve, unresolved };
}

function sidebarOrder(sidebarMd, pageNames, resolver) {
  const order = [];
  const re = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(sidebarMd))) {
    const resolved = resolver.resolve(m[1], "_Sidebar");
    if (!resolved) continue;
    const name = resolved.replace(/\.html.*$/, "");
    if (pageNames.has(name) && !order.includes(name)) order.push(name);
  }
  if (!order.includes("Home") && pageNames.has("Home")) order.unshift("Home");
  const rest = [...pageNames].filter((n) => !order.includes(n)).sort();
  return { order: [...order, ...rest], notInSidebar: rest };
}

function createRenderer(Marked, resolver) {
  let currentPage = "";
  let slugCounts = new Map();
  let headings = [];
  let firstH1 = null;

  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === "link") {
        const resolved = resolver.resolve(token.href, currentPage);
        if (resolved) token.href = resolved;
      }
    },
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        // Like the DOM's textContent: tags removed without adding spaces, as GitHub slugs it.
        const plain = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
        const base = githubSlug(plain) || "section";
        const n = slugCounts.get(base) ?? 0;
        slugCounts.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        if (depth === 1 && firstH1 === null) firstH1 = plain;
        if (depth === 2 || depth === 3) headings.push({ depth, id, text: plain });
        return `<h${depth} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang || "").match(/^\S*/)[0];
        const cls = language ? ` class="language-${escapeHtml(language)}"` : "";
        return `<pre tabindex="0"><code${cls}>${escapeHtml(text.replace(/\n$/, ""))}</code></pre>\n`;
      },
    },
  });

  return {
    render(md, pageName) {
      currentPage = pageName;
      slugCounts = new Map();
      headings = [];
      firstH1 = null;
      let html = marked.parse(md);
      // Wide tables scroll inside their own box instead of the page.
      html = html.replace(/<th(?=[ >])/g, '<th scope="col"').replace(/<table>/g, '<div class="table-wrap" tabindex="0"><table>').replace(/<\/table>/g, "</table></div>");
      return { html, headings, title: firstH1 };
    },
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function guideLayout({ title, pageName, bodyHtml, sidebarHtml, footerHtml, prev, next, toc, hasH1 }) {
  const sidebar = sidebarHtml.replace(
    new RegExp(`href="${pageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.html"`, "g"),
    `href="${pageName}.html" aria-current="page"`,
  );
  const tocHtml =
    toc.filter((h) => h.depth === 2).length >= 3
      ? `<nav class="toc" aria-labelledby="toc-title"><p class="toc-title" id="toc-title">On this page</p><ul>${toc
          .filter((h) => h.depth === 2)
          .map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
          .join("")}</ul></nav>`
      : "";
  const pager =
    prev || next
      ? `<nav class="pager" aria-label="Previous and next page">${
          prev ? `<a class="pager-prev" href="${prev.name}.html" rel="prev"><span>Previous</span>${escapeHtml(prev.title)}</a>` : "<span></span>"
        }${next ? `<a class="pager-next" href="${next.name}.html" rel="next"><span>Next</span>${escapeHtml(next.title)}</a>` : ""}</nav>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · CrabbyTab guide</title>
<meta name="description" content="${escapeHtml(title)}: part of the CrabbyTab guide, a free, offline-first debate tabulation system.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="../assets/crabbytab.svg" type="image/svg+xml">
<link rel="stylesheet" href="../assets/site.css">
<script>document.documentElement.classList.add("js")</script>
</head>
<body class="guide">
<a class="skip-link" href="#content">Skip to content</a>
<header class="topbar">
  <div class="topbar-inner">
    <button class="nav-toggle" type="button" aria-controls="guide-nav" aria-expanded="false" hidden>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      <span>Menu</span>
    </button>
    <a class="brand" href="../index.html"><img src="../assets/crabbytab.svg" alt="" width="24" height="24"><span>CrabbyTab</span><span class="brand-sub">Guide</span></a>
    <div class="search" role="search">
      <label class="visually-hidden" for="search-input">Search the guide</label>
      <input id="search-input" type="search" placeholder="Search the guide" autocomplete="off" spellcheck="false" aria-describedby="search-status" aria-controls="search-results">
      <p id="search-status" class="visually-hidden" role="status" aria-live="polite"></p>
      <ul id="search-results" class="search-results" hidden></ul>
    </div>
    <a class="topbar-link" href="${REPO_URL}">GitHub</a>
  </div>
</header>
<div class="guide-shell">
  <nav id="guide-nav" class="sidebar" aria-label="Guide">
${sidebar}
  </nav>
  <main id="content" class="content" tabindex="-1">
    <article class="prose">
${hasH1 ? "" : `<h1>${escapeHtml(title)}</h1>\n`}${bodyHtml}
    </article>
    ${pager}
    <p class="page-source"><a href="${REPO_URL}/blob/${encodeURIComponent(SOURCE_BRANCH)}/docs/wiki/${encodeURIComponent(pageName)}.md">View the source of this page on GitHub</a></p>
  </main>
  <aside class="toc-column" aria-label="On this page">${tocHtml}</aside>
</div>
<footer class="site-footer">
  <div class="footer-inner">
${footerHtml}
  </div>
</footer>
<script src="../assets/guide.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Link check
// ---------------------------------------------------------------------------

function listHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtml(p));
    else if (entry.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function checkLinks() {
  const files = listHtml(DIST_DIR);
  const idCache = new Map();
  const idsOf = (file) => {
    if (!idCache.has(file)) {
      const html = fs.readFileSync(file, "utf8");
      idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decodeEntities(m[1]))));
    }
    return idCache.get(file);
  };
  const broken = [];
  let checked = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const raw = decodeEntities(m[1]);
      // External links, and root-absolute ones (only 404.html uses those, because GitHub
      // Pages serves it at any depth), are not checked.
      if (!raw || /^([a-z][a-z0-9+.-]*:|\/)/i.test(raw)) continue;
      checked++;
      const hashAt = raw.indexOf("#");
      const pathPart = hashAt === -1 ? raw : raw.slice(0, hashAt);
      let anchor = hashAt === -1 ? "" : raw.slice(hashAt + 1);
      try {
        anchor = decodeURIComponent(anchor);
      } catch {
        /* keep the raw anchor */
      }
      let target = file;
      if (pathPart) {
        let decoded = pathPart;
        try {
          decoded = decodeURI(pathPart);
        } catch {
          /* keep the raw path */
        }
        target = path.resolve(path.dirname(file), decoded);
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
        if (!fs.existsSync(target)) {
          broken.push({ from: path.relative(DIST_DIR, file), href: raw, reason: "missing file" });
          continue;
        }
      }
      if (anchor && target.endsWith(".html") && !idsOf(target).has(anchor)) {
        broken.push({ from: path.relative(DIST_DIR, file), href: raw, reason: "missing anchor" });
      }
    }
  }
  return { checked, broken, files: files.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function build() {
  const { Marked } = await loadMarked();
  const { pages, sidebar, footer } = readWiki();
  const pageNames = new Set(pages.keys());
  const resolver = makeWikiResolver(pageNames);
  const renderer = createRenderer(Marked, resolver);

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  copyDir(SRC_DIR, DIST_DIR);
  fs.mkdirSync(GUIDE_DIR, { recursive: true });
  // The app's logo is the single source of truth; copy it rather than duplicating it in site/src.
  for (const icon of ["crabbytab.svg", "crabbytab-192.png", "og-image.png"]) {
    const from = path.join(ROOT, "public", icon);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DIST_DIR, "assets", icon));
  }
  fs.writeFileSync(path.join(DIST_DIR, ".nojekyll"), "");

  const { order, notInSidebar } = sidebarOrder(sidebar, pageNames, resolver);
  let sidebarHtml = sidebar ? renderer.render(sidebar, "_Sidebar").html : "";
  // Sidebar headings are bold text in the wiki; heading ids would collide with page ids, so strip anchors.
  sidebarHtml = sidebarHtml.replace(/<a class="anchor"[^>]*>#<\/a>/g, "").replace(/(<h\d) id="[^"]*"/g, "$1");
  if (!sidebar) sidebarHtml = `<ul>${order.map((n) => `<li><a href="${n}.html">${escapeHtml(pageTitleFromName(n))}</a></li>`).join("")}</ul>`;
  if (sidebar && notInSidebar.length) {
    sidebarHtml += `<p><strong>More pages</strong></p><ul>${notInSidebar
      .map((n) => `<li><a href="${n}.html">${escapeHtml(pageTitleFromName(n))}</a></li>`)
      .join("")}</ul>`;
  }
  const footerHtml = footer ? renderer.render(footer, "_Footer").html : "";

  const rendered = new Map();
  for (const name of order) rendered.set(name, renderer.render(pages.get(name), name));
  const titleOf = (name) => rendered.get(name).title || pageTitleFromName(name);

  const index = [];
  order.forEach((name, i) => {
    const r = rendered.get(name);
    const prev = i > 0 ? { name: order[i - 1], title: titleOf(order[i - 1]) } : null;
    const next = i < order.length - 1 ? { name: order[i + 1], title: titleOf(order[i + 1]) } : null;
    const html = guideLayout({
      title: titleOf(name),
      pageName: name,
      bodyHtml: r.html,
      sidebarHtml,
      footerHtml,
      prev,
      next,
      toc: r.headings,
      hasH1: Boolean(r.title),
    });
    fs.writeFileSync(path.join(GUIDE_DIR, `${name}.html`), html);
    index.push({
      t: titleOf(name),
      u: `${name}.html`,
      h: r.headings.map((h) => [h.text, h.id]),
      x: stripTags(r.html).replace(/#(?= |$)/g, "").slice(0, 20000),
    });
  });
  // guide/ opens on Home.
  const home = pageNames.has("Home") ? "Home" : order[0];
  fs.writeFileSync(
    path.join(GUIDE_DIR, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CrabbyTab guide</title><meta http-equiv="refresh" content="0; url=${home}.html"><link rel="canonical" href="${home}.html"></head><body><p><a href="${home}.html">Open the CrabbyTab guide</a></p></body></html>\n`,
  );
  fs.writeFileSync(path.join(GUIDE_DIR, "search-index.json"), JSON.stringify(index));

  const links = checkLinks();
  console.log(`Rendered ${order.length} guide pages from docs/wiki into ${path.relative(ROOT, DIST_DIR)}`);
  console.log(`Checked ${links.checked} internal links in ${links.files} HTML files`);
  if (resolver.unresolved.length) {
    console.warn(`Wiki links to pages that do not exist (${resolver.unresolved.length}):`);
    for (const u of resolver.unresolved) console.warn(`  ${u.from}: ${u.href}`);
  }
  if (links.broken.length) {
    console.warn(`Broken internal links (${links.broken.length}):`);
    for (const b of links.broken) console.warn(`  ${b.from}: ${b.href} (${b.reason})`);
    if (STRICT) process.exitCode = 1;
  } else {
    console.log("No broken internal links.");
  }
}

function serve() {
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
  http
    .createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      let file = path.join(DIST_DIR, path.normalize(urlPath).replace(/^([/\\])+/, ""));
      if (!file.startsWith(DIST_DIR)) return res.writeHead(403).end();
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file)) file = path.join(DIST_DIR, "404.html");
      res.writeHead(file.endsWith("404.html") && !urlPath.endsWith("404.html") ? 404 : 200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(4173, () => console.log("Serving site/dist on http://localhost:4173"));
}

build()
  .then(() => {
    if (SERVE) serve();
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
