import { Attachment } from "@server/models";
import {
  attachmentPublicRegex,
  attachmentRedirectRegex,
} from "@shared/utils/ProsemirrorHelper";
import type { ImageFetcher } from "./exportHtml";

/**
 * Extracts an attachment id from any Outline-internal attachment URL the
 * editor produces. Supports the private `/api/attachments.redirect?id=...`
 * form and the public `public/<teamId>/<attachmentId>` form. Returns
 * `undefined` for any other URL (external or malformed).
 *
 * @param url URL string to parse.
 * @returns attachment id or undefined.
 */
export const extractAttachmentId = (url: string): string | undefined => {
  const redirectRe = new RegExp(attachmentRedirectRegex.source, "i");
  const publicRe = new RegExp(attachmentPublicRegex.source, "i");
  const redirectMatch = redirectRe.exec(url);
  if (redirectMatch?.groups?.id) {
    return redirectMatch.groups.id;
  }
  const publicMatch = publicRe.exec(url);
  if (publicMatch?.groups?.id) {
    return publicMatch.groups.id;
  }
  return undefined;
};

/**
 * Builds an `ImageFetcher` scoped to a single team that resolves Outline
 * attachment URLs into their underlying bytes via the FileStorage layer.
 * URLs that do not look like Outline attachments are rejected so the
 * inliner emits a placeholder rather than attempting an arbitrary network
 * fetch — the primary SSRF mitigation for the export pipeline.
 *
 * @param teamId Team the attachments must belong to.
 * @returns an ImageFetcher that resolves attachment URLs to bytes.
 */
export const buildAttachmentFetcher =
  (teamId: string): ImageFetcher =>
  async (url: string) => {
    const attachmentId = extractAttachmentId(url);
    if (!attachmentId) {
      throw new Error(`Refusing to fetch non-Outline image: ${url}`);
    }
    // teamId is the authorization gate — cross-team attachment reads return
    // null and the inliner emits a placeholder rather than leaking bytes.
    const attachment = await Attachment.findOne({
      where: { id: attachmentId, teamId },
    });
    if (!attachment) {
      throw new Error(`Attachment ${attachmentId} not found in team ${teamId}`);
    }
    const bytes = await attachment.buffer;
    return {
      contentType: attachment.contentType ?? "application/octet-stream",
      bytes,
    };
  };
