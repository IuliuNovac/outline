import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import fs from "fs-extra";
import type { NavigationNode } from "@shared/types";
import env from "@server/env";
import type { Document, FileOperation, Collection } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { buildAttachmentFetcher } from "@server/utils/exportAttachments";
import { exportDocumentAsDocx } from "@server/utils/exportDocx";
import { inlineImagesAsDataURIs } from "@server/utils/exportHtml";
import ExportTask from "./ExportTask";

/**
 * Worker task that renders an Outline document (and optionally its subtree)
 * to a Word (.docx) file using the in-process @turbodocx/html-to-docx
 * library. Single-document mode is the only mode wired in this step; Step 4
 * of the blueprint adds the tree-merge orchestration shared with
 * ExportPDFTask.
 */
export default class ExportDocxTask extends ExportTask {
  /**
   * Renders a single document to a .docx file on disk and returns the path.
   * The base class handles upload and cleanup of the temp file.
   *
   * @param document Outline document to render.
   * @param documentStructure Children of the document (rejected for now —
   *   tree-merge is implemented in Step 4).
   * @returns absolute path to the produced DOCX temp file.
   */
  protected async exportDocument(
    document: Document,
    documentStructure: NavigationNode[]
  ): Promise<string> {
    // Defense-in-depth: the route handler gates DOCX_EXPORT_ENABLED but a
    // future path (admin tooling, migration, direct queue enqueue) could
    // bypass the route. Mirror the same env check the PDF task performs
    // against GOTENBERG_URL so a misconfigured worker fails loudly.
    if (!env.DOCX_EXPORT_ENABLED) {
      throw new Error(
        "DOCX export is disabled; set DOCX_EXPORT_ENABLED=true to enable"
      );
    }
    if (documentStructure.length > 0) {
      throw new Error(
        "Tree-merge DOCX export is not yet implemented (Step 4 of the blueprint)"
      );
    }

    const rawHtml = await DocumentHelper.toHTML(document, {
      signedUrls: 300,
      centered: false,
      // DocumentHelper.toHTML emits mermaid blocks that depend on a
      // CDN-loaded JavaScript renderer. html-to-docx does not execute
      // scripts and has no JS sandbox to block CDN fetches, so the diagrams
      // render as empty placeholders here. Mirrors the defensive posture in
      // ExportPDFTask; a server-side mermaid pre-render is left for a
      // follow-up step.
      includeMermaid: false,
    });
    const fetcher = buildAttachmentFetcher(document.teamId);
    const inlinedHtml = await inlineImagesAsDataURIs(rawHtml, fetcher);
    const docxBuffer = await exportDocumentAsDocx(inlinedHtml);

    const tempPath = path.join(
      os.tmpdir(),
      `outline-export-${randomUUID()}.docx`
    );
    await fs.writeFile(tempPath, docxBuffer, { mode: 0o600 });
    return tempPath;
  }

  /**
   * Collection-level DOCX export is intentionally not supported; the feature
   * is per-document only. The route handler prevents this case from reaching
   * the queue.
   *
   * @throws Error always.
   */
  protected async exportCollections(
    _collections: Collection[],
    _fileOperation: FileOperation
  ): Promise<string> {
    throw new Error(
      "DOCX export is per-document only; use the document export route"
    );
  }

  /**
   * @returns the IANA media type for Word OpenXML documents.
   */
  protected getContentType(): string {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}
