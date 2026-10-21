import { parseYouTubeVideo, youtubeEmbedUrl, type YouTubeVideo } from "./youtube";

/**
 * Remark plugin: a YouTube link alone on its own line, or the shortcode `@[youtube](URL or id)`,
 * becomes a responsive privacy-enhanced (youtube-nocookie.com) embed. A link with its own text
 * (`[Watch the final](https://youtu.be/...)`) stays a link. Minimal local node types keep this free
 * of mdast type packages.
 */

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

export interface RemarkYouTubeOptions {
  /** Accessible title of the embedded player (a UI string, translated by the caller). */
  title: string;
}

function textOf(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function sameVideo(left: YouTubeVideo | null, right: YouTubeVideo | null): boolean {
  return Boolean(left && right && left.id === right.id);
}

/** The video a line of inline nodes embeds, if the line is only a bare YouTube link or the shortcode. */
function lineVideo(line: MdNode[]): YouTubeVideo | null {
  const content = line.filter((node) => !(node.type === "text" && !node.value?.trim()));
  const link = content[content.length - 1];
  if (!link || link.type !== "link" || typeof link.url !== "string") return null;
  const video = parseYouTubeVideo(link.url);
  if (!video) return null;
  if (content.length === 1) {
    // A bare (autolinked) URL: the visible text is the URL itself, possibly without its scheme.
    const label = textOf(link).trim();
    return sameVideo(video, parseYouTubeVideo(label)) || sameVideo(video, parseYouTubeVideo(`https://${label}`)) ? video : null;
  }
  if (content.length === 2) {
    const marker = content[0];
    const isShortcode = marker.type === "text" && marker.value?.trim() === "@" && textOf(link).trim().toLowerCase() === "youtube";
    return isShortcode ? video : null;
  }
  return null;
}

interface Line {
  /** The node that started this line (a soft line break "\n" or a hard `break`), absent for the first. */
  separator?: MdNode;
  nodes: MdNode[];
}

function splitLines(children: MdNode[]): Line[] {
  const lines: Line[] = [{ nodes: [] }];
  for (const child of children) {
    if (child.type === "break") {
      lines.push({ separator: child, nodes: [] });
    } else if (child.type === "text" && typeof child.value === "string" && child.value.includes("\n")) {
      child.value.split("\n").forEach((part, index) => {
        if (index > 0) lines.push({ separator: { type: "text", value: "\n" }, nodes: [] });
        if (part) lines[lines.length - 1].nodes.push({ type: "text", value: part });
      });
    } else {
      lines[lines.length - 1].nodes.push(child);
    }
  }
  return lines;
}

function embedNode(video: YouTubeVideo, title: string): MdNode {
  return {
    type: "youtubeEmbed",
    data: {
      hName: "div",
      hProperties: { className: ["ct-md-video"] },
      hChildren: [
        {
          type: "element",
          tagName: "iframe",
          properties: {
            src: youtubeEmbedUrl(video),
            title,
            loading: "lazy",
            allow: "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
            allowFullScreen: true,
            referrerPolicy: "strict-origin-when-cross-origin",
          },
          children: [],
        },
      ],
    },
  };
}

function hasContent(nodes: MdNode[]): boolean {
  return nodes.some((node) => node.type !== "text" || Boolean(node.value?.trim()));
}

/** A paragraph, or the paragraphs and embeds it splits into. */
function splitParagraph(paragraph: MdNode, title: () => string): MdNode[] {
  const lines = splitLines(paragraph.children ?? []);
  const videos = lines.map((line) => lineVideo(line.nodes));
  if (videos.every((video) => video === null)) return [paragraph];
  const result: MdNode[] = [];
  let pending: MdNode[] = [];
  const flush = () => {
    if (hasContent(pending)) result.push({ type: "paragraph", children: pending });
    pending = [];
  };
  lines.forEach((line, index) => {
    const video = videos[index];
    if (video) {
      flush();
      result.push(embedNode(video, title()));
      return;
    }
    if (pending.length > 0 && line.separator) pending.push(line.separator);
    pending.push(...line.nodes);
  });
  flush();
  return result;
}

export function remarkYouTube(options: RemarkYouTubeOptions) {
  return (tree: MdNode) => {
    let count = 0;
    const title = () => {
      count += 1;
      return count === 1 ? options.title : `${options.title} (${count})`;
    };
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => (child.type === "paragraph" ? splitParagraph(child, title) : [child]));
      node.children.forEach(walk);
    };
    walk(tree);
  };
}
