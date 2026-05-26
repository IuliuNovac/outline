/**
 * Adapter around the in-process @turbodocx/html-to-docx library used by the
 * DOCX export pipeline. Pure JS conversion — no sidecar, no network — so the
 * primary SSRF defense for image references must be enforced *before* the
 * conversion. `assertNoRemoteImages` fails closed at the entry point so the
 * underlying library's internal axios fetcher never sees a remote URL.
 * Mirrors the defense baked into server/utils/gotenberg.ts for the PDF path.
 */

import HtmlToDocx from "@turbodocx/html-to-docx";

// Defense-in-depth: assert no remote image references survive Step 1's
// inlineImagesAsDataURIs before handing HTML to @turbodocx/html-to-docx
// (whose internal axios fetcher would otherwise hit them on the worker's
// network). The library processes <img>, <source srcset>, and SVG <image>
// elements; all three are gated below, for both quoted and unquoted
// attribute values. The current Outline document HTML pipeline only emits
// <img> in practice, but the broader gates are deliberate future-proofing
// against a library or DocumentHelper change that begins to emit them.
const REMOTE_IMG_RE =
  /<img[^>]*\ssrc\s*=\s*(?:["'](?!data:)[^"']+["']|(?!data:)[^\s>"']+)/i;
const REMOTE_SOURCE_SRCSET_RE =
  /<source[^>]*\ssrcset\s*=\s*(?:["'](?!data:)[^"']+["']|(?!data:)[^\s>"']+)/i;
const REMOTE_SVG_IMAGE_RE =
  /<image[^>]*\s(?:xlink:href|href|src)\s*=\s*(?:["'](?!data:)[^"']+["']|(?!data:)[^\s>"']+)/i;
const OOXML_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const assertNoRemoteImages = (html: string): void => {
  if (REMOTE_IMG_RE.test(html)) {
    throw new Error(
      "All <img src> values must be inlined as data: URIs before passing to html-to-docx"
    );
  }
  if (REMOTE_SOURCE_SRCSET_RE.test(html)) {
    throw new Error(
      "All <source srcset> values must be inlined as data: URIs before passing to html-to-docx"
    );
  }
  if (REMOTE_SVG_IMAGE_RE.test(html)) {
    throw new Error(
      "All <image href> values must be inlined as data: URIs before passing to html-to-docx"
    );
  }
};

const assertValidDocxMagic = (buffer: Buffer): void => {
  if (buffer.length < 4 || !OOXML_ZIP_MAGIC.equals(buffer.subarray(0, 4))) {
    throw new Error(
      "html-to-docx output is not a valid OOXML zip (missing PK magic)"
    );
  }
};

export interface ExportDocumentAsDocxOptions {
  /** Font family applied to the body of the document. Optional. */
  font?: string;
}

/**
 * Renders an HTML fragment to a Word (.docx) Buffer via the in-process
 * @turbodocx/html-to-docx library. All `<img>` / `<source srcset>` / SVG
 * `<image>` references MUST already be `data:` URIs; the entry-point
 * assertion fails closed otherwise so the library's own image fetcher
 * never reaches the network.
 *
 * @param html input HTML; all images already inlined as data: URIs.
 * @param options optional rendering knobs.
 * @returns OOXML zip bytes as a Node Buffer.
 * @throws Error when html is empty, contains a non-data <img>/<source>/<image>
 *   reference, or the library output fails the PK magic-byte check.
 */
export const exportDocumentAsDocx = async (
  html: string,
  options: ExportDocumentAsDocxOptions = {}
): Promise<Buffer> => {
  if (!html || !html.trim()) {
    throw new Error("exportDocumentAsDocx requires non-empty HTML input");
  }
  assertNoRemoteImages(html);

  const documentOptions: { font?: string } = {};
  if (options.font) {
    documentOptions.font = options.font;
  }

  const result = await HtmlToDocx(html, null, documentOptions, null);
  let buffer: Buffer;
  if (Buffer.isBuffer(result)) {
    buffer = result;
  } else if (result instanceof ArrayBuffer) {
    buffer = Buffer.from(result);
  } else {
    throw new Error(
      "html-to-docx returned a Blob in a Node context; expected Buffer or ArrayBuffer"
    );
  }
  assertValidDocxMagic(buffer);
  return buffer;
};
