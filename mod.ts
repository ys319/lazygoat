/**
 * lazygoat - A lazy-evaluating email (MIME) parser for Deno.
 *
 * Designed for FaaS environments with CPU time constraints.
 * Zero parsing at construction time; each property is computed on demand.
 *
 * @example
 * ```ts
 * import { parse } from "./mod.ts";
 *
 * const msg = parse(rawEmail);
 * console.log(msg.subject);   // only parses headers
 * console.log(msg.text);      // only decodes text/plain part
 * ```
 *
 * @module
 */

export { parse, LazyMessage } from "./src/message.ts";
export type { Address, Attachment } from "./src/message.ts";
export type { MediaType } from "./src/media_type.ts";
export { HeaderMap } from "./src/header.ts";
export { MimePart } from "./src/part.ts";

// Re-export codec utilities for advanced use
export {
  decodeBase64,
  decodeQuotedPrintable,
  decodeRfc2047,
  decodeCharset,
  decodeTransferEncoding,
} from "./src/codec.ts";

export { parseMediaType } from "./src/media_type.ts";
export { parseAddressList } from "./src/address.ts";

// mbox support
export {
  parseMbox,
  parseMboxStream,
  countMboxMessages,
} from "./src/mbox.ts";
export type { MboxEnvelope, MboxMessage } from "./src/mbox.ts";
