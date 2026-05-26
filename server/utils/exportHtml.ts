import { JSDOM } from "jsdom";

/**
 * Result of fetching an image referenced by an `<img src="...">` URL.
 */
export interface FetchedImage {
  contentType: string;
  bytes: Buffer;
}

/**
 * Function injected into `inlineImagesAsDataURIs` to resolve image URLs to
 * bytes. Real callers wire it through Outline's authenticated attachment path
 * so renderer subprocesses never make network requests of their own.
 */
export type ImageFetcher = (url: string) => Promise<FetchedImage>;

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const OUTLINE_DOC_LINK_RE = /\/doc\/(?:[0-9a-zA-Z-_~]*-)?([a-zA-Z0-9]{10,15})/g;

const parseFragment = (html: string): { dom: JSDOM; doc: Document } => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return { dom, doc: dom.window.document };
};

const serializeBody = (doc: Document): string => doc.body.innerHTML;

/**
 * Shifts every `<h1>`-`<h6>` element by `depthOffset`, capped at H6. Headings
 * inside `<pre>` or `<code>` containers are left untouched so syntax-quoted
 * heading examples in code blocks survive unchanged.
 *
 * @param html input HTML fragment.
 * @param depthOffset positive integer to add to each heading level.
 * @returns serialized HTML with heading levels shifted.
 */
export const shiftHeadings = (html: string, depthOffset: number): string => {
  if (depthOffset === 0) {
    return html;
  }
  const { doc } = parseFragment(html);
  const captured = Array.from(doc.querySelectorAll(HEADING_TAGS.join(","))).map(
    (el) => ({
      el,
      level: Number(el.tagName.toLowerCase().charAt(1)),
    })
  );
  for (const { el, level } of captured) {
    if (el.closest("pre") || el.closest("code")) {
      continue;
    }
    const newLevel = Math.min(6, level + depthOffset);
    if (newLevel === level) {
      continue;
    }
    const replacement = doc.createElement(`h${newLevel}`);
    for (const attr of Array.from(el.attributes)) {
      replacement.setAttribute(attr.name, attr.value);
    }
    replacement.innerHTML = el.innerHTML;
    el.replaceWith(replacement);
  }
  return serializeBody(doc);
};

/**
 * Computes a deterministic, URL-safe anchor slug from an Outline document id.
 * The slug matches the shortid form used in document URLs so cross-doc link
 * rewriting collapses to a single regex pass. Pass `document.urlId` (always 10
 * alphanumeric chars, no hyphens) rather than `document.id` (UUID with
 * hyphens) when the caller can; both forms are accepted.
 *
 * @param docId Outline document urlId (preferred) or UUID.
 * @returns slug of the form `doc-<shortid>`.
 */
export const computeAnchorSlug = (docId: string): string =>
  `doc-${docId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12)}`;

/**
 * Injects an `id` attribute onto the first `<h1>`-`<h6>` element appearing in
 * document order. No-ops when no heading is present. Preserves an existing
 * matching id; leaves a conflicting id in place (the heading already owns an
 * anchor, so the merge step links to that one instead).
 *
 * @param html input HTML fragment.
 * @param anchor anchor slug to inject.
 * @returns serialized HTML with the anchor applied.
 */
export const injectFirstHeadingAnchor = (
  html: string,
  anchor: string
): string => {
  const { doc } = parseFragment(html);
  const heading = doc.querySelector(HEADING_TAGS.join(","));
  if (!heading) {
    return html;
  }
  const existing = heading.getAttribute("id");
  if (existing && existing !== anchor) {
    return serializeBody(doc);
  }
  heading.setAttribute("id", anchor);
  return serializeBody(doc);
};

/**
 * Rewrites Outline-internal document URLs to in-page fragment anchors. Looks
 * up each `/doc/{...}-{shortid}` href in `anchorMap` keyed by shortid; on hit
 * replaces the href with `#<anchor>`. Out-of-tree links and external URLs are
 * left untouched.
 *
 * @param html input HTML fragment.
 * @param anchorMap shortid → anchor slug.
 * @returns serialized HTML with in-tree links rewritten.
 */
export const rewriteOutlineDocLinks = (
  html: string,
  anchorMap: Map<string, string>
): string =>
  html.replace(OUTLINE_DOC_LINK_RE, (match, shortId: string) => {
    const anchor = anchorMap.get(shortId);
    return anchor ? `#${anchor}` : match;
  });

const filenameFromUrl = (url: string): string => {
  try {
    const u = new URL(url, "https://placeholder.invalid");
    const path = u.pathname.split("/").pop() ?? "image";
    return path || "image";
  } catch {
    return "image";
  }
};

/**
 * Replaces every `<img src="http(s)://...">` reference with a `data:` URI by
 * invoking the supplied fetcher. Data URIs already in the markup are preserved
 * verbatim. On fetch failure an inline placeholder span replaces the image so
 * the export does not surface broken-image icons.
 *
 * The fetcher MUST be wired through Outline's authenticated attachment service
 * so the renderer never makes network requests of its own — this is the
 * primary SSRF mitigation.
 *
 * No per-image size limit is enforced here; the merge orchestrator (Step 4)
 * caps the total post-inline HTML size and the fetcher should reject
 * oversize attachments before returning bytes.
 *
 * @param html input HTML fragment.
 * @param fetcher async resolver from URL to bytes + content type.
 * @returns serialized HTML with all remote image references inlined.
 */
export const inlineImagesAsDataURIs = async (
  html: string,
  fetcher: ImageFetcher
): Promise<string> => {
  const { doc } = parseFragment(html);
  const images = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) {
        return;
      }
      try {
        const { contentType, bytes } = await fetcher(src);
        const base64 = bytes.toString("base64");
        img.setAttribute("src", `data:${contentType};base64,${base64}`);
      } catch {
        const placeholder = doc.createElement("span");
        placeholder.setAttribute("class", "export-image-error");
        placeholder.textContent = `[image: ${filenameFromUrl(src)}]`;
        img.replaceWith(placeholder);
      }
    })
  );
  return serializeBody(doc);
};
