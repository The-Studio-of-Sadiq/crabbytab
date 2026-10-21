import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/components/ui/cn";
import { isExternalLink, safeImageUrl, safeMarkdownUrl } from "@/lib/markdown/safeUrls";
import { remarkYouTube } from "@/lib/markdown/remarkYouTube";
import { isYouTubeEmbedUrl } from "@/lib/markdown/youtube";

/**
 * Organiser-written Markdown for the public site (the public homepage). Untrusted input, so:
 * - raw HTML is dropped (`skipHtml`), never passed through;
 * - every URL goes through `safeMarkdownUrl`: links http(s)/mailto/site paths, images https,
 *   iframes only the youtube-nocookie embeds remarkYouTube builds;
 * - `rehypeHarden` removes event-handler properties and any iframe that is not such an embed;
 * - KaTeX runs untrusted (`trust: false`: no \href, \url, \includegraphics or \html*), with
 *   size and macro-expansion limits, and renders errors in place instead of throwing.
 * Headings are shifted down one level (`#` → h2) because the page title is the only h1.
 *
 * Styling lives in markdown.css, loaded with KaTeX's stylesheet by SafeMarkdown.tsx so pages
 * without Markdown do not load either.
 */

/** Longest Markdown rendered (the preference is validated to this length too). */
export const MARKDOWN_MAX_LENGTH = 20_000;

export const KATEX_OPTIONS = {
  trust: false,
  strict: "ignore",
  maxSize: 10,
  maxExpand: 200,
  output: "htmlAndMathml",
} as const;

/** Elements no Markdown construct should produce; dropped (with their content) if one ever does. */
const DISALLOWED_ELEMENTS = [
  "script",
  "style",
  "object",
  "embed",
  "form",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
  "frame",
  "frameset",
  "noscript",
  "template",
  "video",
  "audio",
  "source",
  "track",
  "foreignObject",
];

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Rehype plugin: no event handlers or srcdoc anywhere, and no iframe other than a YouTube embed. */
function rehypeHarden() {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (!node.children) return;
      node.children = node.children.filter(
        (child) =>
          child.type !== "element" ||
          child.tagName !== "iframe" ||
          (typeof child.properties?.src === "string" && isYouTubeEmbedUrl(child.properties.src))
      );
      for (const child of node.children) {
        if (child.properties) {
          for (const key of Object.keys(child.properties)) {
            if (/^on/i.test(key) || (/^(srcdoc|srcset|formaction|xlinkhref|href)$/i.test(key) && child.tagName !== "a")) {
              delete child.properties[key];
            }
          }
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

const HEADINGS = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;

function shiftedHeading(level: number): NonNullable<Components["h1"]> {
  const Tag = HEADINGS[level - 1];
  return function Heading({ node: _node, ...props }) {
    void _node;
    return <Tag {...props} />;
  };
}

const COMPONENTS: Components = {
  h1: shiftedHeading(1),
  h2: shiftedHeading(2),
  h3: shiftedHeading(3),
  h4: shiftedHeading(4),
  h5: shiftedHeading(5),
  h6: shiftedHeading(6),
  a({ node: _node, href, children, ...props }) {
    void _node;
    // A rejected URL arrives as "": the text stays, the link does not.
    if (!href) return <span>{children}</span>;
    const external = isExternalLink(href);
    return (
      <a
        {...props}
        href={href}
        rel="noopener noreferrer nofollow"
        {...(external ? { target: "_blank" } : {})}
      >
        {children}
      </a>
    );
  },
  img({ node: _node, src, alt, title }) {
    void _node;
    const safe = typeof src === "string" ? safeImageUrl(src) : null;
    if (!safe) return alt ? <span className="ct-md-missing-image">{alt}</span> : null;
    return (
      // Organiser images are arbitrary https URLs, so next/image (which needs known hosts) is not used.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={safe} alt={alt ?? ""} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    );
  },
  iframe({ node: _node, src, title, allow, allowFullScreen, loading, referrerPolicy }) {
    void _node;
    if (typeof src !== "string" || !isYouTubeEmbedUrl(src)) return null;
    return (
      <iframe
        src={src}
        title={title}
        allow={allow}
        allowFullScreen={allowFullScreen}
        loading={loading}
        referrerPolicy={referrerPolicy}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      />
    );
  },
  input({ node: _node, type, checked }) {
    void _node;
    // GFM task list items; anything else is not a Markdown construct.
    if (type !== "checkbox") return null;
    return <input type="checkbox" checked={Boolean(checked)} disabled readOnly />;
  },
  table({ node: _node, ...props }) {
    void _node;
    // Wide tables scroll inside the content instead of widening the page.
    return (
      <div className="ct-md-table">
        <table {...props} />
      </div>
    );
  },
};

export interface MarkdownRendererProps {
  source: string;
  /** Accessible title of embedded videos (translated by the caller). */
  videoTitle: string;
  className?: string;
}

export function MarkdownRenderer({ source, videoTitle, className }: MarkdownRendererProps) {
  return (
    <div className={cn("ct-markdown", className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, [remarkYouTube, { title: videoTitle }]]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS], rehypeHarden]}
        disallowedElements={DISALLOWED_ELEMENTS}
        urlTransform={safeMarkdownUrl}
        components={COMPONENTS}
      >
        {source.slice(0, MARKDOWN_MAX_LENGTH)}
      </ReactMarkdown>
    </div>
  );
}
