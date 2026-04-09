/**
 * LazyMessage: the top-level lazy email parser.
 *
 * Construction does ZERO parsing. Every property is computed on first access
 * and cached, making this ideal for FaaS environments where CPU time is limited
 * and only specific fields are needed per invocation.
 *
 * Lazy evaluation levels:
 *   0. Constructor: store raw input only
 *   1. Header/body boundary detection
 *   2. Header field splitting
 *   3. Per-header value decoding (RFC 2047)
 *   4. MIME structure parsing
 *   5. Content decoding (base64/QP + charset)
 */

import { type Address, parseAddressList } from "./address.ts";
import { HeaderMap } from "./header.ts";
import { type MediaType, parseMediaType } from "./media_type.ts";
import { MimePart } from "./part.ts";

export { type Address } from "./address.ts";
export { HeaderMap } from "./header.ts";
export { type MediaType } from "./media_type.ts";
export { MimePart } from "./part.ts";

// Shared TextEncoder instance (avoid per-call allocation)
const TEXT_ENCODER = new TextEncoder();

export interface Attachment {
  /** Filename (if available). */
  readonly filename: string;
  /** MIME type string. */
  readonly mimeType: string;
  /** Decoded content bytes. */
  readonly content: Uint8Array;
  /** Content-ID (for inline). */
  readonly contentId: string | null;
  /** "attachment" or "inline". */
  readonly disposition: string;
}

/**
 * A lazily-parsed email message.
 *
 * No parsing occurs at construction time. Each property triggers only the
 * minimum parsing necessary to compute its value, and results are cached
 * for subsequent accesses.
 */
export class LazyMessage {
  #raw: string;

  // Level 1: header/body boundary
  #headerEnd: number | undefined;
  #bodyStart: number | undefined;
  #hasBodySeparator = false;

  // Level 2-3: headers
  #headers: HeaderMap | undefined;

  // Level 4: MIME root part
  #rootContentType: MediaType | undefined;
  #rootPart: MimePart | undefined;
  #mimeParts: MimePart[] | undefined;

  // Level 5: decoded content caches
  #cache = new Map<string, unknown>();

  /**
   * Create a lazy message from raw email data.
   * ZERO parsing happens here — everything is deferred.
   */
  constructor(raw: string | Uint8Array) {
    if (raw instanceof Uint8Array) {
      this.#raw = new TextDecoder("utf-8", { fatal: false }).decode(raw);
    } else {
      this.#raw = raw;
    }
  }

  // ── Header/body boundary (Level 1) ──

  #ensureSplit(): void {
    if (this.#headerEnd !== undefined) return;

    const raw = this.#raw;
    // Search for \r\n\r\n or \n\n
    const crlfIdx = raw.indexOf("\r\n\r\n");
    const lfIdx = raw.indexOf("\n\n");

    if (crlfIdx >= 0 && (lfIdx < 0 || crlfIdx <= lfIdx)) {
      this.#headerEnd = crlfIdx;
      this.#bodyStart = crlfIdx + 4;
      this.#hasBodySeparator = true;
    } else if (lfIdx >= 0) {
      this.#headerEnd = lfIdx;
      this.#bodyStart = lfIdx + 2;
      this.#hasBodySeparator = true;
    } else {
      // No body — entire message is headers
      this.#headerEnd = raw.length;
      this.#bodyStart = raw.length;
    }
  }

  /** Raw header section string. */
  get rawHeaderSection(): string {
    this.#ensureSplit();
    return this.#raw.slice(0, this.#headerEnd!);
  }

  /** Raw body section string. */
  get rawBodySection(): string {
    this.#ensureSplit();
    return this.#raw.slice(this.#bodyStart!);
  }

  // ── Headers (Level 2-3) ──

  /** Lazily parsed header map. */
  get headers(): HeaderMap {
    if (!this.#headers) {
      this.#headers = new HeaderMap(this.rawHeaderSection);
    }
    return this.#headers;
  }

  // ── Convenience header accessors ──

  /** Decoded Subject header. */
  get subject(): string {
    return this.#cached("subject", () => this.headers.get("subject") ?? "");
  }

  /** Parsed From addresses. */
  get from(): Address[] {
    return this.#cached("from", () =>
      parseAddressList(this.headers.get("from") ?? ""),
    );
  }

  /** Parsed To addresses. */
  get to(): Address[] {
    return this.#cached("to", () =>
      parseAddressList(this.headers.get("to") ?? ""),
    );
  }

  /** Parsed Cc addresses. */
  get cc(): Address[] {
    return this.#cached("cc", () =>
      parseAddressList(this.headers.get("cc") ?? ""),
    );
  }

  /** Parsed Bcc addresses. */
  get bcc(): Address[] {
    return this.#cached("bcc", () =>
      parseAddressList(this.headers.get("bcc") ?? ""),
    );
  }

  /** Parsed Reply-To addresses. */
  get replyTo(): Address[] {
    return this.#cached("replyTo", () =>
      parseAddressList(this.headers.get("reply-to") ?? ""),
    );
  }

  /** Parsed Date header. */
  get date(): Date | null {
    return this.#cached("date", () => {
      const raw = this.headers.get("date");
      if (!raw) return null;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    });
  }

  /** Message-ID header (without angle brackets). */
  get messageId(): string {
    return this.#cached("messageId", () => {
      const raw = this.headers.get("message-id") ?? "";
      return stripAngleBrackets(raw.trim());
    });
  }

  /** In-Reply-To header. */
  get inReplyTo(): string {
    return this.#cached("inReplyTo", () => {
      const raw = this.headers.get("in-reply-to") ?? "";
      return stripAngleBrackets(raw.trim());
    });
  }

  /** References header (list of message IDs). */
  get references(): string[] {
    return this.#cached("references", () => {
      const raw = this.headers.get("references") ?? "";
      if (!raw.trim()) return [];
      return raw
        .trim()
        .split(/\s+/)
        .map((r) => stripAngleBrackets(r));
    });
  }

  /** MIME-Version header. */
  get mimeVersion(): string {
    return this.#cached(
      "mimeVersion",
      () => this.headers.get("mime-version") ?? "",
    );
  }

  // ── Content-Type (root level) ──

  /** Root Content-Type. */
  get contentType(): MediaType {
    if (!this.#rootContentType) {
      this.#rootContentType = parseMediaType(
        this.headers.get("content-type") ?? undefined,
      );
    }
    return this.#rootContentType;
  }

  // ── MIME parts (Level 4) ──

  /** The root MIME part (lazy). */
  get rootPart(): MimePart {
    if (!this.#rootPart) {
      const bodyBytes = TEXT_ENCODER.encode(this.rawBodySection);
      this.#rootPart = new MimePart(this.rawHeaderSection, bodyBytes);
    }
    return this.#rootPart;
  }

  /**
   * All MIME parts flattened (lazy).
   * For non-multipart messages, returns a single-element array.
   */
  get parts(): MimePart[] {
    if (!this.#mimeParts) {
      this.#mimeParts = flattenParts(this.rootPart);
    }
    return this.#mimeParts;
  }

  // ── Body content (Level 5) ──

  /**
   * Plain text body content (lazy).
   * Searches MIME tree for text/plain part.
   * Returns null if no text/plain part exists.
   */
  get text(): string | null {
    return this.#cached("text", () => {
      this.#ensureSplit();
      if (!this.#hasBodySeparator) return null;
      return findBodyContent(this.rootPart, "text", "plain");
    });
  }

  /**
   * HTML body content (lazy).
   * Searches MIME tree for text/html part.
   * Returns null if no text/html part exists.
   */
  get html(): string | null {
    return this.#cached("html", () => {
      this.#ensureSplit();
      if (!this.#hasBodySeparator) return null;
      return findBodyContent(this.rootPart, "text", "html");
    });
  }

  /**
   * Attachment list (lazy).
   * Extracts parts with Content-Disposition: attachment,
   * or non-text/non-multipart parts without inline disposition.
   */
  get attachments(): Attachment[] {
    return this.#cached("attachments", () => {
      const result: Attachment[] = [];
      collectAttachments(this.rootPart, result);
      return result;
    });
  }

  /**
   * Inline parts (images etc. referenced by Content-ID).
   */
  get inlineAttachments(): Attachment[] {
    return this.#cached("inlineAttachments", () => {
      const result: Attachment[] = [];
      collectInline(this.rootPart, result);
      return result;
    });
  }

  // ── Private helpers ──

  #cached<T>(key: string, compute: () => T): T {
    if (!this.#cache.has(key)) {
      this.#cache.set(key, compute());
    }
    return this.#cache.get(key) as T;
  }
}

/**
 * Parse raw email data into a LazyMessage.
 * This is the main entry point.
 */
export function parse(raw: string | Uint8Array): LazyMessage {
  return new LazyMessage(raw);
}

// ── Eager parse API ──

/**
 * A fully-parsed MIME part structure (plain object, no lazy evaluation).
 */
export interface ParsedPart {
  /** Parsed Content-Type. */
  readonly contentType: MediaType;
  /** Content-Transfer-Encoding value. */
  readonly transferEncoding: string;
  /** Charset from Content-Type. */
  readonly charset: string;
  /** Content-Disposition value. */
  readonly disposition: string | null;
  /** Filename from Content-Disposition or Content-Type. */
  readonly filename: string | null;
  /** Content-ID header. */
  readonly contentId: string | null;
  /** Whether this is a multipart type. */
  readonly isMultipart: boolean;
  /** Whether this is a text type. */
  readonly isText: boolean;
  /** Decoded text content (null for non-text parts). */
  readonly text: string | null;
  /** Transfer-decoded body bytes. */
  readonly body: Uint8Array;
  /** Child parts (for multipart types). */
  readonly parts: ParsedPart[];
  /** All headers as key-value pairs. */
  readonly headers: ReadonlyArray<[string, string]>;
}

/**
 * A fully-parsed email message (plain object, no lazy evaluation).
 * Useful for debugging, serialization, and complete inspection.
 */
export interface ParsedMessage {
  /** Decoded Subject header. */
  readonly subject: string;
  /** Parsed From addresses. */
  readonly from: readonly Address[];
  /** Parsed To addresses. */
  readonly to: readonly Address[];
  /** Parsed Cc addresses. */
  readonly cc: readonly Address[];
  /** Parsed Bcc addresses. */
  readonly bcc: readonly Address[];
  /** Parsed Reply-To addresses. */
  readonly replyTo: readonly Address[];
  /** Parsed Date header. */
  readonly date: Date | null;
  /** Message-ID header (without angle brackets). */
  readonly messageId: string;
  /** In-Reply-To header. */
  readonly inReplyTo: string;
  /** References header (list of message IDs). */
  readonly references: readonly string[];
  /** MIME-Version header. */
  readonly mimeVersion: string;
  /** Root Content-Type. */
  readonly contentType: MediaType;
  /** Plain text body content. */
  readonly text: string | null;
  /** HTML body content. */
  readonly html: string | null;
  /** Attachment list. */
  readonly attachments: readonly Attachment[];
  /** Inline attachment list. */
  readonly inlineAttachments: readonly Attachment[];
  /** All headers as key-value pairs. */
  readonly headers: ReadonlyArray<[string, string]>;
  /** Full MIME tree structure. */
  readonly rootPart: ParsedPart;
  /** All leaf MIME parts flattened. */
  readonly parts: readonly ParsedPart[];
}

/**
 * Eagerly resolve a MimePart into a plain ParsedPart object.
 */
function resolvePart(part: MimePart, depth = 0): ParsedPart {
  const childParts = depth > MAX_MIME_DEPTH
    ? []
    : part.parts.map((child) => resolvePart(child, depth + 1));
  return {
    contentType: part.contentType,
    transferEncoding: part.transferEncoding,
    charset: part.charset,
    disposition: part.disposition,
    filename: part.filename,
    contentId: part.contentId,
    isMultipart: part.isMultipart,
    isText: part.isText,
    text: part.text,
    body: part.body,
    parts: childParts,
    headers: [...part.headers.entries()],
  };
}

/**
 * Parse raw email data and eagerly evaluate ALL properties.
 *
 * Unlike `parse()` which returns a lazy message, this function immediately
 * parses everything and returns a plain object. Useful for:
 * - Debugging and inspection
 * - Serialization (JSON.stringify-friendly, except for Uint8Array fields)
 * - Cases where you need all fields and want predictable timing
 *
 * @example
 * ```ts
 * import { parseEager } from "./mod.ts";
 *
 * const msg = parseEager(rawEmail);
 * console.log(JSON.stringify(msg, null, 2)); // inspect full structure
 * ```
 */
export function parseEager(raw: string | Uint8Array): ParsedMessage {
  const msg = new LazyMessage(raw);
  const rootPart = resolvePart(msg.rootPart);

  // Flatten leaf parts from the resolved tree
  const leafParts: ParsedPart[] = [];
  function collectLeaves(part: ParsedPart): void {
    if (part.isMultipart) {
      for (const child of part.parts) {
        collectLeaves(child);
      }
    } else {
      leafParts.push(part);
    }
  }
  collectLeaves(rootPart);

  return {
    subject: msg.subject,
    from: msg.from,
    to: msg.to,
    cc: msg.cc,
    bcc: msg.bcc,
    replyTo: msg.replyTo,
    date: msg.date,
    messageId: msg.messageId,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    mimeVersion: msg.mimeVersion,
    contentType: msg.contentType,
    text: msg.text,
    html: msg.html,
    attachments: msg.attachments,
    inlineAttachments: msg.inlineAttachments,
    headers: [...msg.headers.entries()],
    rootPart,
    parts: leafParts,
  };
}

// ── Utility functions ──

/** Maximum MIME tree recursion depth to prevent stack overflow on malicious inputs. */
const MAX_MIME_DEPTH = 50;

function stripAngleBrackets(s: string): string {
  if (s.startsWith("<") && s.endsWith(">")) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Flatten the MIME tree into a list of leaf parts.
 * Uses accumulator pattern to avoid intermediate array allocations.
 */
function flattenParts(
  part: MimePart,
  out: MimePart[] = [],
  depth = 0,
): MimePart[] {
  if (depth > MAX_MIME_DEPTH) return out;
  if (part.isMultipart) {
    for (const child of part.parts) {
      flattenParts(child, out, depth + 1);
    }
  } else {
    out.push(part);
  }
  return out;
}

/**
 * Search the MIME tree for a body part of the specified type.
 *
 * For multipart/alternative: find the matching type among children.
 * For multipart/mixed, multipart/related: recurse into children.
 * For leaf parts: check if type matches.
 */
function findBodyContent(
  part: MimePart,
  type: string,
  subtype: string,
  depth = 0,
): string | null {
  if (depth > MAX_MIME_DEPTH) return null;
  const ct = part.contentType;

  // Leaf text part matching target type
  if (ct.type === type && ct.subtype === subtype) {
    // Skip parts with Content-Disposition: attachment
    if (part.disposition === "attachment") return null;
    return part.text;
  }

  if (ct.type === "multipart") {
    if (ct.subtype === "alternative") {
      // In multipart/alternative, search from last to first (prefer richest format)
      // but return the specific type requested
      for (const child of part.parts) {
        const result = findBodyContent(child, type, subtype, depth + 1);
        if (result !== null) return result;
      }
    } else {
      // multipart/mixed, multipart/related, etc.
      // Recurse into each child
      for (const child of part.parts) {
        const result = findBodyContent(child, type, subtype, depth + 1);
        if (result !== null) return result;
      }
    }
  }

  return null;
}

/**
 * Collect explicit attachment parts from the MIME tree.
 */
function collectAttachments(part: MimePart, out: Attachment[], depth = 0): void {
  if (depth > MAX_MIME_DEPTH) return;
  if (part.isMultipart) {
    for (const child of part.parts) {
      collectAttachments(child, out, depth + 1);
    }
    return;
  }

  // A part is an attachment if:
  // 1. Content-Disposition is "attachment", OR
  // 2. It's not a text/* or message/* type in the main body flow
  const disp = part.disposition;
  if (disp === "attachment") {
    out.push(partToAttachment(part));
    return;
  }

  // Non-text, non-multipart, non-message parts without explicit inline are attachments
  if (
    disp !== "inline" &&
    part.contentType.type !== "text" &&
    part.contentType.type !== "message"
  ) {
    out.push(partToAttachment(part));
  }
}

/**
 * Collect inline parts (Content-Disposition: inline with Content-ID).
 */
function collectInline(part: MimePart, out: Attachment[], depth = 0): void {
  if (depth > MAX_MIME_DEPTH) return;
  if (part.isMultipart) {
    for (const child of part.parts) {
      collectInline(child, out, depth + 1);
    }
    return;
  }

  if (part.disposition === "inline" && part.contentId) {
    out.push(partToAttachment(part));
  }
}

function partToAttachment(part: MimePart): Attachment {
  const ct = part.contentType;
  return {
    filename: part.filename ?? "",
    mimeType: `${ct.type}/${ct.subtype}`,
    content: part.body,
    contentId: part.contentId,
    disposition: part.disposition ?? "attachment",
  };
}
