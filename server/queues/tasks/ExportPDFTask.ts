import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import fs from "fs-extra";
import type { NavigationNode } from "@shared/types";
import env from "@server/env";
import type { Document, FileOperation, Collection } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { buildAttachmentFetcher } from "@server/utils/exportAttachments";
import { inlineImagesAsDataURIs } from "@server/utils/exportHtml";
import { htmlToPdf } from "@server/utils/gotenberg";
import ExportTask from "./ExportTask";

/**
 * Worker task that renders an Outline document (and optionally its subtree)
 * to PDF via the configured Gotenberg sidecar. Single-document mode is the
 * only mode exercised in this step; Step 4 wires the tree-merge path.
 */
export default class ExportPDFTask extends ExportTask {
  /**
   * Renders a single document to PDF. The subtree path is wired in Step 4;
   * for now only the empty `documentStructure` case is supported.
   *
   * @param document Outline document to render.
   * @param documentStructure Children of the document (ignored for now).
   * @returns absolute path to the produced PDF temp file.
   */
  protected async exportDocument(
    document: Document,
    documentStructure: NavigationNode[]
  ): Promise<string> {
    if (documentStructure.length > 0) {
      throw new Error(
        "Tree-merge PDF export is not yet implemented (Step 4 of the blueprint)"
      );
    }
    if (!env.GOTENBERG_URL) {
      throw new Error(
        "PDF export requires the GOTENBERG_URL env var to point at a Gotenberg sidecar"
      );
    }

    const rawHtml = await DocumentHelper.toHTML(document, {
      signedUrls: 300,
      centered: false,
      // Mermaid imports its renderer from a CDN. Step 6 hardens Gotenberg
      // with --chromium-disable-javascript; until then we render mermaid
      // diagrams as empty blocks rather than leaking export traffic to a
      // third party. Re-enable in Step 6 once the JS sandbox is in place.
      includeMermaid: false,
    });
    const fetcher = buildAttachmentFetcher(document.teamId);
    const inlinedHtml = await inlineImagesAsDataURIs(rawHtml, fetcher);
    const pdfBuffer = await htmlToPdf(inlinedHtml, {
      gotenbergUrl: env.GOTENBERG_URL,
    });

    const tempPath = path.join(
      os.tmpdir(),
      `outline-export-${randomUUID()}.pdf`
    );
    await fs.writeFile(tempPath, pdfBuffer, { mode: 0o600 });
    return tempPath;
  }

  /**
   * Collection-level PDF export is intentionally not supported; the feature
   * is per-document only. The base class only calls this when the inbound
   * FileOperation has no documentId, which the route handler prevents for
   * PDF format.
   *
   * @throws Error always.
   */
  protected async exportCollections(
    _collections: Collection[],
    _fileOperation: FileOperation
  ): Promise<string> {
    throw new Error(
      "PDF export is per-document only; use the document export route"
    );
  }

  /**
   * @returns the IANA media type for PDF.
   */
  protected getContentType(): string {
    return "application/pdf";
  }
}
