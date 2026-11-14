import { describe, expect, it } from "vitest";
import {
  hasInfoSlide,
  isVideoFileUrl,
  normalizeInfoSlideMedia,
  resolveInfoSlideMedia,
  withValidInfoSlideMedia,
} from "./infoSlideMedia";

describe("info slide media", () => {
  it("accepts https images and rejects other schemes", () => {
    expect(resolveInfoSlideMedia({ kind: "image", url: "https://example.org/a.png", alt: "Map" })).toEqual({
      type: "image",
      src: "https://example.org/a.png",
      alt: "Map",
    });
    for (const url of ["http://example.org/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//example.org/a.png", "https://user:pw@example.org/a.png"]) {
      expect(resolveInfoSlideMedia({ kind: "image", url }), url).toBeNull();
    }
  });

  it("turns YouTube links into privacy-enhanced embeds", () => {
    expect(resolveInfoSlideMedia({ kind: "video", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90" })).toEqual({
      type: "youtube",
      src: "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?start=90",
      title: "",
    });
    expect(resolveInfoSlideMedia({ kind: "video", url: "https://youtu.be/aqz-KE-bpKQ" })?.type).toBe("youtube");
    // A bare video id is not a link.
    expect(resolveInfoSlideMedia({ kind: "video", url: "aqz-KE-bpKQ" })).toBeNull();
  });

  it("plays https video files by extension only", () => {
    expect(isVideoFileUrl("https://cdn.example.org/clip.mp4?token=1")).toBe(true);
    expect(isVideoFileUrl("https://cdn.example.org/clip.WEBM")).toBe(true);
    expect(isVideoFileUrl("http://cdn.example.org/clip.mp4")).toBe(false);
    expect(isVideoFileUrl("https://cdn.example.org/page.html")).toBe(false);
    expect(resolveInfoSlideMedia({ kind: "video", url: "https://cdn.example.org/clip.mp4", alt: "Clip" })).toEqual({
      type: "video",
      src: "https://cdn.example.org/clip.mp4",
      title: "Clip",
    });
    // A video link saved as an image (or the reverse) is not shown.
    expect(resolveInfoSlideMedia({ kind: "image", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" })?.type).toBe("image");
    expect(resolveInfoSlideMedia({ kind: "video", url: "https://example.org/a.png" })).toBeNull();
  });

  it("normalises before saving: trims, drops empty media, rejects bad links", () => {
    expect(normalizeInfoSlideMedia(undefined)).toEqual({ ok: true, media: undefined });
    expect(normalizeInfoSlideMedia({ kind: "image", url: "   " })).toEqual({ ok: true, media: undefined });
    expect(normalizeInfoSlideMedia({ kind: "image", url: " https://example.org/a.png ", alt: "  " })).toEqual({
      ok: true,
      media: { kind: "image", url: "https://example.org/a.png" },
    });
    expect(normalizeInfoSlideMedia({ kind: "gif", url: "https://example.org/a.gif" }).ok).toBe(false);
    expect(normalizeInfoSlideMedia({ kind: "video", url: "https://example.org/a.png" })).toMatchObject({ ok: false });
    expect(normalizeInfoSlideMedia({ kind: "image", url: `https://example.org/${"a".repeat(2000)}` }).ok).toBe(false);
    expect(normalizeInfoSlideMedia("https://example.org/a.png").ok).toBe(false);
  });

  it("validates a motion's media, removing the field when empty and throwing when invalid", () => {
    const motion = { id: "m1", text: "THW", infoSlideMedia: { kind: "image" as const, url: "" } };
    expect(withValidInfoSlideMedia(motion)).toEqual({ id: "m1", text: "THW" });
    expect(() => withValidInfoSlideMedia({ ...motion, infoSlideMedia: { kind: "image", url: "http://x.org/a.png" } })).toThrow(/https/);
  });

  it("counts a motion with only media as having an info slide", () => {
    expect(hasInfoSlide({ infoSlide: "  " })).toBe(false);
    expect(hasInfoSlide({ infoSlide: "Context" })).toBe(true);
    expect(hasInfoSlide({ infoSlideMedia: { kind: "image", url: "https://example.org/a.png" } })).toBe(true);
  });
});
