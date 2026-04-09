/**
 * MIME part representation with lazy content decoding.
 */

import { decodeCharset, decodeTransferEncoding } from "./codec.ts";
import { HeaderMap } from "./header.ts";
import { type MediaType, parseMediaType } from "./media_type.ts";

const CRLF = "\r\n";
const LF = "\n";

// Shared encoder/decoder instances (avoid per-call allocation in hot paths)
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });
const TEXT_ENCODER = new TextEncoder();

/** Maximum number of MIME parts to prevent DoS from malicious inputs. */
const MAX_MIME_PARTS = 10_000;

/**
 * Represents a single MIME part with lazy evaluation.
 *
 * - Headers are parsed lazily via HeaderMap
 * - Content-Type is parsed on first access
 * - Body is transfer-decoded on first access
 * - Text content is charset-decoded on first access
 * - Child parts (for multipart) are parsed on first access
 */
export class MimePart {
  #rawHeaderSection: string;
  #rawBody: Uint8Array;

  // Lazy caches
  #headers: HeaderMap | undefined;
  #contentType: MediaType | undefined;
  #decodedBody: Uint8Array | undefined;
  #textContent: string | null | undefined;
  #textContentComputed = false;
  #children: MimePart[] | undefined;
  #childrenComputed = false;

  constructor(rawHeaderSection: string, rawBody: Uint8Array) {
    this.#rawHeaderSection = rawHeaderSection;
    this.#rawBody = rawBody;
  }

  /** Parsed headers (lazy). */
  get headers(): HeaderMap {
    if (!this.#headers) {
      this.#headers = new HeaderMap(this.#rawHeaderSection);
    }
    return this.#headers;
  }

  /** Parsed Content-Type (lazy). */
  get contentType(): MediaType {
    if (!this.#contentType) {
      this.#contentType = parseMediaType(
        this.headers.get("content-type") ?? undefined,
      );
    }
    return this.#contentType;
  }

  /** Content-Transfer-Encoding value. */
  get transferEncoding(): string {
    return this.headers.get("content-transfer-encoding") ?? "7bit";
  }

  /** Charset from Content-Type, defaulting to UTF-8. */
  get charset(): string {
    return this.contentType.params.get("charset") ?? "utf-8";
  }

  /** Content-Disposition value (e.g., "attachment", "inline"). */
  get disposition(): string | null {
    const val = this.headers.get("content-disposition");
    if (!val) return null;
    const semi = val.indexOf(";");
    return (semi >= 0 ? val.slice(0, semi) : val).trim().toLowerCase();
  }

  /** Filename from Content-Disposition or Content-Type name param. */
  get filename(): string | null {
    // Try Content-Disposition filename parameter
    const disp = this.headers.get("content-disposition");
    if (disp) {
      const fn = extractParam(disp, "filename");
      if (fn) return fn;
    }
    // Fallback: Content-Type name parameter
    return this.contentType.params.get("name") ?? null;
  }

  /** Content-ID header value. */
  get contentId(): string | null {
    const cid = this.headers.get("content-id");
    if (!cid) return null;
    // Strip angle brackets
    const trimmed = cid.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  /** Whether this is a multipart type. */
  get isMultipart(): boolean {
    return this.contentType.type === "multipart";
  }

  /** Whether this is a text type. */
  get isText(): boolean {
    return this.contentType.type === "text";
  }

  /** Raw body bytes (before transfer decoding). */
  get rawBody(): Uint8Array {
    return this.#rawBody;
  }

  /**
   * Transfer-decoded body bytes (lazy).
   * Applies base64/quoted-printable decoding.
   */
  get body(): Uint8Array {
    if (!this.#decodedBody) {
      this.#decodedBody = decodeTransferEncoding(
        this.#rawBody,
        this.transferEncoding,
      );
    }
    return this.#decodedBody;
  }

  /**
   * Decoded text content (lazy).
   * Returns null for non-text parts.
   */
  get text(): string | null {
    if (!this.#textContentComputed) {
      if (this.isText) {
        this.#textContent = decodeCharset(this.body, this.charset);
      } else {
        this.#textContent = null;
      }
      this.#textContentComputed = true;
    }
    return this.#textContent ?? null;
  }

  /**
   * Child parts for multipart types (lazy).
   * Returns empty array for non-multipart types.
   */
  get parts(): MimePart[] {
    if (!this.#childrenComputed) {
      if (this.isMultipart) {
        const boundary = this.contentType.params.get("boundary");
        if (boundary) {
          this.#children = splitMultipartBody(this.#rawBody, boundary);
        } else {
          this.#children = [];
        }
      } else {
        this.#children = [];
      }
      this.#childrenComputed = true;
    }
    return this.#children ?? [];
  }
}

/**
 * Split a multipart body into MIME parts by boundary.
 *
 * Structure:
 *   [preamble]
 *   --boundary\r\n
 *   [part headers]\r\n\r\n[part body]
 *   --boundary\r\n
 *   [part headers]\r\n\r\n[part body]
 *   --boundary--
 *   [epilogue]
 */
export function splitMultipartBody(
  body: Uint8Array,
  boundary: string,
): MimePart[] {
  // Sanitize boundary: strip control characters that would break line-based parsing
  const cleanBoundary = boundary.replace(/[\r\n]/g, "");
  if (cleanBoundary.length === 0) return [];

  const text = UTF8_DECODER.decode(body);
  const delimiter = "--" + cleanBoundary;
  const closeDelimiter = delimiter + "--";

  const parts: MimePart[] = [];
  let searchFrom = 0;

  // Find first boundary (skip preamble)
  const firstBoundaryIdx = findBoundary(text, delimiter, searchFrom);
  if (firstBoundaryIdx < 0) return [];

  // Move past the first boundary line
  searchFrom = skipPastLine(text, firstBoundaryIdx + delimiter.length);

  while (searchFrom < text.length) {
    // Find next boundary
    const nextBoundaryIdx = findBoundary(text, delimiter, searchFrom);
    if (nextBoundaryIdx < 0) {
      // No more boundaries - remaining content is the last part
      const partContent = text.slice(searchFrom);
      const part = parsePartContent(partContent);
      if (part) parts.push(part);
      break;
    }

    // Extract content between boundaries
    // Remove the trailing CRLF/LF before the boundary delimiter
    let endIdx = nextBoundaryIdx;
    if (endIdx > 0 && text[endIdx - 1] === "\n") endIdx--;
    if (endIdx > 0 && text[endIdx - 1] === "\r") endIdx--;

    const partContent = text.slice(searchFrom, endIdx);
    const part = parsePartContent(partContent);
    if (part) parts.push(part);

    // Enforce part count limit to prevent DoS
    if (parts.length >= MAX_MIME_PARTS) break;

    // Check for close delimiter
    if (
      text.slice(nextBoundaryIdx, nextBoundaryIdx + closeDelimiter.length) ===
        closeDelimiter
    ) {
      break;
    }

    // Move past this boundary line
    searchFrom = skipPastLine(text, nextBoundaryIdx + delimiter.length);
  }

  return parts;
}

/**
 * Find a boundary marker at the beginning of a line.
 */
function findBoundary(text: string, delimiter: string, from: number): number {
  let idx = from;
  while (idx < text.length) {
    const found = text.indexOf(delimiter, idx);
    if (found < 0) return -1;

    // Boundary must be at the start of a line (or at position 0)
    if (found === 0 || text[found - 1] === "\n") {
      return found;
    }

    // Not at start of line — skip to next line to avoid O(n²) rescanning
    const nlIdx = text.indexOf("\n", found + 1);
    idx = nlIdx >= 0 ? nlIdx + 1 : text.length;
  }
  return -1;
}

/**
 * Skip past the end of the current line.
 */
function skipPastLine(text: string, from: number): number {
  const crlfIdx = text.indexOf(CRLF, from);
  const lfIdx = text.indexOf(LF, from);

  if (crlfIdx >= 0 && (lfIdx < 0 || crlfIdx <= lfIdx)) {
    return crlfIdx + 2;
  }
  if (lfIdx >= 0) {
    return lfIdx + 1;
  }
  return text.length;
}

/**
 * Parse a part's content (headers + body) into a MimePart.
 */
function parsePartContent(content: string): MimePart | null {
  if (content.trim() === "") return null;

  // Find header/body boundary
  let splitIdx = content.indexOf("\r\n\r\n");
  let bodyOffset = 4;
  if (splitIdx < 0) {
    splitIdx = content.indexOf("\n\n");
    bodyOffset = 2;
  }

  let headerSection: string;
  let bodyStr: string;

  if (splitIdx >= 0) {
    headerSection = content.slice(0, splitIdx);
    bodyStr = content.slice(splitIdx + bodyOffset);
  } else {
    // No body, just headers
    headerSection = content;
    bodyStr = "";
  }

  const bodyBytes = TEXT_ENCODER.encode(bodyStr);
  return new MimePart(headerSection, bodyBytes);
}

/**
 * Extract a parameter value from a structured header value.
 * Supports both plain parameters and RFC 2231 encoded parameters (name*=charset'lang'value).
 * e.g., extractParam('attachment; filename="test.pdf"', 'filename') => 'test.pdf'
 */
function extractParam(headerValue: string, paramName: string): string | null {
  const lower = headerValue.toLowerCase();
  const target = paramName.toLowerCase();

  // Try RFC 2231 encoded parameter first (name*=charset'lang'encoded_value)
  const rfc2231Result = extractRfc2231Param(headerValue, lower, target);
  if (rfc2231Result !== null) return rfc2231Result;

  // Find the plain parameter
  let idx = 0;
  while (idx < lower.length) {
    const paramIdx = lower.indexOf(target, idx);
    if (paramIdx < 0) return null;

    // Check it's preceded by ';' or whitespace
    if (paramIdx > 0) {
      const prev = lower[paramIdx - 1];
      if (prev !== ";" && prev !== " " && prev !== "\t") {
        idx = paramIdx + 1;
        continue;
      }
    }

    // Make sure the next non-whitespace char after name is '=' (not '*=')
    let eqIdx = paramIdx + target.length;
    while (
      eqIdx < headerValue.length &&
      (headerValue[eqIdx] === " " || headerValue[eqIdx] === "\t")
    ) {
      eqIdx++;
    }

    if (eqIdx >= headerValue.length || headerValue[eqIdx] !== "=") {
      idx = eqIdx + 1;
      continue;
    }
    // Skip if this is actually a RFC 2231 param (name*=)
    if (headerValue[paramIdx + target.length] === "*") {
      idx = eqIdx + 1;
      continue;
    }

    // Extract value
    let valIdx = eqIdx + 1;
    while (
      valIdx < headerValue.length &&
      (headerValue[valIdx] === " " || headerValue[valIdx] === "\t")
    ) {
      valIdx++;
    }

    if (valIdx < headerValue.length && headerValue[valIdx] === '"') {
      // Quoted value
      const endQuote = headerValue.indexOf('"', valIdx + 1);
      if (endQuote >= 0) {
        return headerValue.slice(valIdx + 1, endQuote).replace(/\\(.)/g, "$1");
      }
      // Unclosed quote: take value up to next semicolon or end of string
      let endIdx = valIdx + 1;
      while (endIdx < headerValue.length && headerValue[endIdx] !== ";") {
        endIdx++;
      }
      return headerValue.slice(valIdx + 1, endIdx).trim();
    }

    // Token value
    let endIdx = valIdx;
    while (
      endIdx < headerValue.length && headerValue[endIdx] !== ";" &&
      headerValue[endIdx] !== " " && headerValue[endIdx] !== "\t"
    ) {
      endIdx++;
    }
    return headerValue.slice(valIdx, endIdx);
  }

  return null;
}

/**
 * Extract an RFC 2231 encoded parameter (name*=charset'language'encoded_value).
 */
function extractRfc2231Param(
  headerValue: string,
  lower: string,
  target: string,
): string | null {
  const starTarget = target + "*";
  let idx = 0;
  while (idx < lower.length) {
    const paramIdx = lower.indexOf(starTarget, idx);
    if (paramIdx < 0) return null;

    // Check it's preceded by ';' or whitespace
    if (paramIdx > 0) {
      const prev = lower[paramIdx - 1];
      if (prev !== ";" && prev !== " " && prev !== "\t") {
        idx = paramIdx + 1;
        continue;
      }
    }

    // Find '=' after "name*"
    let eqIdx = paramIdx + starTarget.length;
    while (
      eqIdx < headerValue.length &&
      (headerValue[eqIdx] === " " || headerValue[eqIdx] === "\t")
    ) {
      eqIdx++;
    }

    if (eqIdx >= headerValue.length || headerValue[eqIdx] !== "=") {
      idx = eqIdx + 1;
      continue;
    }

    // Extract raw value
    let valIdx = eqIdx + 1;
    while (
      valIdx < headerValue.length &&
      (headerValue[valIdx] === " " || headerValue[valIdx] === "\t")
    ) {
      valIdx++;
    }

    let rawValue: string;
    if (valIdx < headerValue.length && headerValue[valIdx] === '"') {
      const endQuote = headerValue.indexOf('"', valIdx + 1);
      rawValue = endQuote >= 0
        ? headerValue.slice(valIdx + 1, endQuote)
        : headerValue.slice(valIdx + 1);
    } else {
      let endIdx = valIdx;
      while (
        endIdx < headerValue.length && headerValue[endIdx] !== ";" &&
        headerValue[endIdx] !== " " && headerValue[endIdx] !== "\t"
      ) {
        endIdx++;
      }
      rawValue = headerValue.slice(valIdx, endIdx);
    }

    // Decode: charset'language'percent-encoded-value
    const firstApos = rawValue.indexOf("'");
    if (firstApos < 0) return rawValue;
    const charset = rawValue.slice(0, firstApos);
    const secondApos = rawValue.indexOf("'", firstApos + 1);
    if (secondApos < 0) return rawValue;
    const encoded = rawValue.slice(secondApos + 1);

    return decodeRfc2231Percent(encoded, charset);
  }
  return null;
}

/**
 * Decode RFC 2231 percent-encoded value with charset.
 */
function decodeRfc2231Percent(encoded: string, charset: string): string {
  const out = new Uint8Array(encoded.length);
  let j = 0;
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === "%" && i + 2 < encoded.length) {
      const hi = hexVal(encoded.charCodeAt(i + 1));
      const lo = hexVal(encoded.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out[j++] = (hi << 4) | lo;
        i += 2;
        continue;
      }
    }
    out[j++] = encoded.charCodeAt(i);
  }
  return decodeCharset(out.subarray(0, j), charset || "utf-8");
}

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}
