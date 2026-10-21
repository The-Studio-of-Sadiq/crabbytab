import { describe, expect, it } from "vitest";
import { firstParagraphText } from "./plainText";
import { isExternalLink, safeImageUrl, safeLinkUrl, safeMarkdownUrl } from "./safeUrls";
import { isYouTubeEmbedUrl, parseStartTime, parseYouTubeVideo, youtubeEmbedUrl } from "./youtube";

describe("parseYouTubeVideo", () => {
  it("reads every common YouTube URL form", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "http://youtu.be/dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ]) {
      expect(parseYouTubeVideo(url), url).toEqual({ id: "dQw4w9WgXcQ" });
    }
  });

  it("reads start times", () => {
    expect(parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=42")).toEqual({ id: "dQw4w9WgXcQ", start: 42 });
    expect(parseYouTubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s")).toEqual({ id: "dQw4w9WgXcQ", start: 3723 });
    expect(parseYouTubeVideo("https://www.youtube.com/embed/dQw4w9WgXcQ?start=90")).toEqual({ id: "dQw4w9WgXcQ", start: 90 });
    expect(parseStartTime("abc")).toBeUndefined();
    expect(parseStartTime("0")).toBeUndefined();
    expect(parseStartTime("999999")).toBeUndefined();
  });

  it("rejects other hosts, malformed ids and credentials", () => {
    for (const url of [
      "https://evil.example/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ\"><script>",
      "https://user:pass@youtu.be/dQw4w9WgXcQ",
      "javascript:alert('dQw4w9WgXcQ')",
      "https://www.youtube.com/channel/UC1234567890",
    ]) {
      expect(parseYouTubeVideo(url), url).toBeNull();
    }
  });

  it("builds only youtube-nocookie embed URLs", () => {
    expect(youtubeEmbedUrl({ id: "dQw4w9WgXcQ" })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(youtubeEmbedUrl({ id: "dQw4w9WgXcQ", start: 5 })).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5");
    expect(isYouTubeEmbedUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5")).toBe(true);
    expect(isYouTubeEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(false);
    expect(isYouTubeEmbedUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1")).toBe(false);
  });
});

describe("safe Markdown URLs", () => {
  it("allows http(s), mailto and site paths for links only", () => {
    expect(safeLinkUrl("https://example.org/a")).toBe("https://example.org/a");
    expect(safeLinkUrl("http://example.org")).toBe("http://example.org");
    expect(safeLinkUrl("mailto:tab@example.org")).toBe("mailto:tab@example.org");
    expect(safeLinkUrl("/open/public")).toBe("/open/public");
    expect(safeLinkUrl("#venues")).toBe("#venues");
    for (const url of ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "java\nscript:x", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "//evil.example", "/\\evil.example", "relative/path", ""]) {
      expect(safeLinkUrl(url), JSON.stringify(url)).toBeNull();
    }
  });

  it("allows only https images", () => {
    expect(safeImageUrl("https://example.org/a.png")).toBe("https://example.org/a.png");
    expect(safeImageUrl("http://example.org/a.png")).toBeNull();
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeImageUrl("/local.png")).toBeNull();
  });

  it("decides by element and attribute", () => {
    expect(safeMarkdownUrl("https://example.org", "href", { tagName: "a" })).toBe("https://example.org");
    expect(safeMarkdownUrl("https://example.org", "cite", { tagName: "blockquote" })).toBe("");
    expect(safeMarkdownUrl("https://evil.example/", "src", { tagName: "iframe" })).toBe("");
    expect(safeMarkdownUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "src", { tagName: "iframe" })).not.toBe("");
    expect(isExternalLink("https://example.org")).toBe(true);
    expect(isExternalLink("mailto:a@b.c")).toBe(false);
    expect(isExternalLink("/open/public")).toBe(false);
  });
});

describe("firstParagraphText", () => {
  it("skips headings, images, videos, code and maths to the first prose paragraph", () => {
    const markdown = [
      "# Welcome to the Open",
      "",
      "![Banner](https://example.org/banner.png)",
      "",
      "https://youtu.be/dQw4w9WgXcQ",
      "",
      "```",
      "not this",
      "",
      "or this",
      "```",
      "",
      "$$x^2$$",
      "",
      "The **Open** is a _three-day_ [BP tournament](https://example.org) at `Main Hall`; entry\\* costs $\\pounds 20$.",
      "",
      "Second paragraph.",
    ].join("\n");
    expect(firstParagraphText(markdown)).toBe("The Open is a three-day BP tournament at Main Hall; entry* costs \\pounds 20.");
  });

  it("keeps snake_case words, strips list and quote markers", () => {
    expect(firstParagraphText("> Use the file_name_here form")).toBe("Use the file_name_here form");
    expect(firstParagraphText("- First item\n- Second item")).toBe("First item Second item");
    expect(firstParagraphText("***both***")).toBe("both");
  });

  it("returns nothing for content without prose", () => {
    expect(firstParagraphText("")).toBe("");
    expect(firstParagraphText("## Only a heading\n\n---")).toBe("");
  });
});
