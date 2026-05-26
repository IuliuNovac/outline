/**
 * HTTP client for the Gotenberg (https://gotenberg.dev) sidecar service used
 * to render HTML to PDF. This module is the only network surface for the PDF
 * export pipeline — every other rendering primitive is in-process.
 *
 * Security model: the caller MUST inline all image references as `data:` URIs
 * before invocation. `htmlToPdf` enforces this at the upload boundary as a
 * defense-in-depth check; combined with `--chromium-deny-list` on the
 * Gotenberg service it eliminates the SSRF surface that would otherwise exist
 * via `<img src="http://...">` markup in user-authored documents.
 */

import { randomBytes } from "crypto";
import Logger from "@server/logging/Logger";

/**
 * Thrown when Gotenberg returns a non-2xx status. Carries the HTTP status code
 * so the worker can decide whether to retry or give up.
 */
export class GotenbergError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GotenbergError";
    this.status = status;
  }
}

export interface HtmlToPdfOptions {
  /** Base URL of the Gotenberg service. Required; trailing slash tolerated. */
  gotenbergUrl: string;
  /** Optional `waitDelay` to pass to Gotenberg (default `1s`). */
  waitDelay?: string;
  /** Optional paper margin (CSS length string, e.g., `0.4in`). */
  marginTop?: string;
}

/**
 * Asserts the supplied HTML contains no `<img>` elements with `http(s)://`
 * sources. Throws to fail closed at the network boundary.
 *
 * @param html input HTML to validate.
 * @throws Error when any non-data `<img src>` is found.
 */
const assertNoRemoteImages = (html: string): void => {
  const remoteImgRe = /<img[^>]*\ssrc\s*=\s*["'](?!data:)[^"']+["']/i;
  if (remoteImgRe.test(html)) {
    throw new Error(
      "Remote <img src> URLs must be inlined as data: URIs before upload to Gotenberg"
    );
  }
};

const buildMultipart = (
  html: string,
  waitDelay: string,
  marginTop: string | undefined
): { body: Buffer; contentType: string } => {
  const boundary = `----outline-export-${randomBytes(16).toString("hex")}`;
  const parts: Buffer[] = [];
  const append = (s: string) => {
    parts.push(Buffer.from(s, "utf8"));
  };
  const appendField = (name: string, value: string) => {
    append(`--${boundary}\r\n`);
    append(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    append(`${value}\r\n`);
  };
  const appendFile = (
    name: string,
    filename: string,
    contentType: string,
    body: Buffer
  ) => {
    append(`--${boundary}\r\n`);
    append(
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`
    );
    append(`Content-Type: ${contentType}\r\n\r\n`);
    parts.push(body);
    append("\r\n");
  };

  appendFile("files", "index.html", "text/html", Buffer.from(html, "utf8"));
  appendField("waitDelay", waitDelay);
  if (marginTop) {
    appendField("marginTop", marginTop);
  }
  append(`--${boundary}--\r\n`);

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

/**
 * Renders an HTML document to PDF by uploading it to a Gotenberg sidecar.
 * The injected `fetcher` is used for tests; production callers pass the
 * platform's `fetch` global.
 *
 * @param html input HTML; all images must already be data: URIs.
 * @param options Gotenberg service URL and tuning knobs.
 * @param fetcher optional fetch override (for tests).
 * @returns PDF bytes.
 * @throws GotenbergError on non-2xx response.
 * @throws Error when html contains remote image references or output is
 *   not a valid PDF.
 */
export const htmlToPdf = async (
  html: string,
  options: HtmlToPdfOptions,
  fetcher: typeof fetch = fetch
): Promise<Buffer> => {
  if (!options.gotenbergUrl) {
    throw new Error("htmlToPdf requires a non-empty gotenbergUrl");
  }
  assertNoRemoteImages(html);

  const { body, contentType } = buildMultipart(
    html,
    options.waitDelay ?? "1s",
    options.marginTop
  );

  const url =
    options.gotenbergUrl.replace(/\/+$/, "") + "/forms/chromium/convert/html";

  const response = await fetcher(url, {
    method: "POST",
    body: new Blob([new Uint8Array(body)], { type: contentType }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Log the full body server-side; surface only the status to fileOperation.error
    // so any sensitive Gotenberg stderr (paths, document fragments) is not exposed
    // to the user-facing failure email or admin panel.
    Logger.warn("PDF export: Gotenberg returned non-2xx", {
      status: response.status,
      body: text,
    });
    throw new GotenbergError(
      `Gotenberg responded ${response.status}`,
      response.status
    );
  }

  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.slice(0, 5).toString() !== "%PDF-") {
    throw new Error("Gotenberg response is not a valid PDF (missing magic)");
  }
  return buf;
};
