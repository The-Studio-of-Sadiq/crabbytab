import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

const render = (source: string) =>
  renderToStaticMarkup(React.createElement(MarkdownRenderer, { source, videoTitle: "YouTube video" }));

/** Every opening tag name in the markup. */
const tags = (html: string) => [...html.matchAll(/<([a-zA-Z][\w-]*)/g)].map((match) => match[1].toLowerCase());

describe("MarkdownRenderer security", () => {
  it("drops raw HTML instead of passing it through", () => {
    const html = render('Hello <script>alert(1)</script>\n\n<script>alert(2)</script>\n\n<div onclick="x()">div</div>');
    expect(tags(html)).not.toContain("script");
    // A block of raw HTML disappears; text between inline tags stays as escaped text.
    expect(html).not.toContain("alert(2)");
    expect(html).not.toMatch(/onclick/i);
    expect(html.replace(/\s+/g, "")).toBe('<divclass="ct-markdown"><p>Helloalert(1)</p></div>');
  });

  it("never renders an <img onerror> or any event handler", () => {
    const html = render('<img src="https://example.org/x.png" onerror="alert(1)">\n\n![ok](https://example.org/a.png)');
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toContain("alert(1)");
    expect(html).toContain('src="https://example.org/a.png"');
  });

  it("strips javascript:, data: and vbscript: links but keeps their text", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox"]) {
      const html = render(`[click me](${url})`);
      expect(html, url).not.toMatch(/href=/);
      expect(html, url).toContain("click me");
    }
    expect(render("<javascript:alert(1)>")).not.toMatch(/href="javascript/i);
  });

  it("only renders https images (no data:, http: or javascript:)", () => {
    expect(render("![pixel](data:image/png;base64,iVBORw0KGgo=)")).not.toContain("<img");
    expect(render("![insecure](http://example.org/a.png)")).not.toContain("<img");
    expect(render("![x](javascript:alert(1))")).not.toContain("<img");
    const html = render('![Team photo](https://example.org/team.jpg "Our team")');
    expect(html).toContain('<img src="https://example.org/team.jpg" alt="Team photo" title="Our team" loading="lazy" decoding="async"');
  });

  it("renders no arbitrary iframes", () => {
    const html = render('<iframe src="https://evil.example/"></iframe>\n\n<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>');
    expect(tags(html)).not.toContain("iframe");
    expect(render("@[youtube](https://evil.example/embed/dQw4w9WgXcQ)")).not.toContain("<iframe");
  });

  it("marks links nofollow, and opens external ones in a new tab", () => {
    const external = render("[Tabbycat](https://tabbycat.example/)");
    expect(external).toContain('href="https://tabbycat.example/"');
    expect(external).toContain('rel="noopener noreferrer nofollow"');
    expect(external).toContain('target="_blank"');
    const mail = render("[Email us](mailto:tab@example.org)");
    expect(mail).toContain('href="mailto:tab@example.org"');
    expect(mail).not.toContain("target=");
    expect(render("[Schedule](/open/schedule/public)")).toContain('href="/open/schedule/public"');
    expect(render("[Elsewhere](//evil.example/)")).not.toMatch(/href=/);
  });

  it("does not let KaTeX emit links, classes or raw HTML", () => {
    const html = render("$\\href{javascript:alert(1)}{x}$ and $\\url{https://evil.example}$ and $\\htmlClass{x}{y}$");
    // The TeX source stays visible as text (an error and the MathML annotation), never as markup.
    expect(html).not.toMatch(/<a[ >]/);
    expect(html).not.toMatch(/href=/);
    expect(html).not.toContain('class="x"');
    expect(html).toContain("katex");
  });

  it("survives macro bombs and huge sizes", () => {
    const bomb = "$$\\def\\a{\\b\\b\\b\\b\\b\\b\\b\\b}\\def\\b{\\c\\c\\c\\c\\c\\c\\c\\c}\\def\\c{xxxxxxxxxx}\\a\\a\\a\\a$$";
    expect(() => render(bomb)).not.toThrow();
    expect(render(bomb).length).toBeLessThan(200_000);
    expect(() => render("$\\rule{100000em}{100000em}$")).not.toThrow();
  });
});

describe("MarkdownRenderer content", () => {
  it("renders GFM: tables, task lists, strikethrough, autolinks and headings shifted below the page title", () => {
    const html = render(
      [
        "# Welcome",
        "",
        "| Round | Time |",
        "| --- | ---: |",
        "| R1 | 09:00 |",
        "",
        "- [x] Registration",
        "- [ ] Briefing",
        "",
        "~~cancelled~~ and **bold** _italic_",
        "",
        "Visit https://example.org today.",
        "",
        "> quoted",
        "",
        "---",
        "",
        "```",
        "code block",
        "```",
      ].join("\n")
    );
    expect(html).toContain("<h2>Welcome</h2>");
    expect(tags(html)).not.toContain("h1");
    expect(html).toContain("<table>");
    expect(html).toContain("<th");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<del>cancelled</del>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="https://example.org"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<hr/>");
    expect(html).toContain("<pre><code>code block");
  });

  it("renders inline and display maths with KaTeX", () => {
    const html = render("Energy $E = mc^2$.\n\n$$\n\\frac{a}{b}\n$$");
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
    expect(html).toContain("<math");
  });

  it("embeds a YouTube link on its own line, but keeps a labelled link a link", () => {
    const html = render("Watch the final:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s\nThanks!\n\n[Trailer](https://youtu.be/dQw4w9WgXcQ)");
    expect(html).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90" title="YouTube video"');
    expect(html).toContain("<p>Watch the final:</p>");
    expect(html).toContain("<p>Thanks!</p>");
    expect(html).toContain('href="https://youtu.be/dQw4w9WgXcQ"');
    expect(html.match(/<iframe/g)).toHaveLength(1);
  });

  it("accepts youtu.be, shorts, embed URLs and the shortcode", () => {
    for (const source of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "<https://youtu.be/dQw4w9WgXcQ>",
      "www.youtube.com/watch?v=dQw4w9WgXcQ",
      "@[youtube](dQw4w9WgXcQ)",
      "@[youtube](https://youtu.be/dQw4w9WgXcQ?t=42)",
    ]) {
      expect(render(source), source).toMatch(/<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ(\?start=42)?"/);
    }
  });

  it("numbers the titles of several videos", () => {
    const html = render("https://youtu.be/dQw4w9WgXcQ\n\nhttps://youtu.be/9bZkp7q19f0");
    expect(html).toContain('title="YouTube video"');
    expect(html).toContain('title="YouTube video (2)"');
  });
});
