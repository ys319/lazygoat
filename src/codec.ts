/**
 * Encoding/decoding utilities for email content.
 *
 * Handles Base64, Quoted-Printable, RFC 2047 encoded words,
 * and charset conversion.
 */

// Base64 lookup table (ASCII code → 6-bit value)
const B64 = new Uint8Array(128);
{
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  B64.fill(0xff);
  for (let i = 0; i < 64; i++) B64[chars.charCodeAt(i)] = i;
  B64[0x3d] = 0; // '=' padding treated as 0
}

/**
 * Decode a Base64 string to bytes.
 * Tolerant of whitespace and line breaks in input.
 */
export function decodeBase64(input: string): Uint8Array {
  // Strip all whitespace (regex is fast in V8's C++ implementation)
  const clean = input.replace(/[\r\n \t]/g, "");

  const len = clean.length;
  if (len === 0) return new Uint8Array(0);

  // Calculate output size accounting for padding
  let padding = 0;
  if (clean[len - 1] === "=") padding++;
  if (clean[len - 2] === "=") padding++;
  const outLen = ((len * 3) >>> 2) - padding;

  const out = new Uint8Array(outLen);
  let j = 0;

  for (let i = 0; i < len; i += 4) {
    const a = B64[clean.charCodeAt(i)];
    const b = B64[clean.charCodeAt(i + 1)];
    const c = B64[clean.charCodeAt(i + 2)];
    const d = B64[clean.charCodeAt(i + 3)];

    out[j++] = (a << 2) | (b >>> 4);
    if (j < outLen) out[j++] = ((b & 0x0f) << 4) | (c >>> 2);
    if (j < outLen) out[j++] = ((c & 0x03) << 6) | d;
  }

  return out;
}

/**
 * Hex character to nibble value (0-15), or -1 for invalid.
 */
function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x46) return c - 0x37; // A-F
  if (c >= 0x61 && c <= 0x66) return c - 0x57; // a-f
  return -1;
}

/**
 * Decode Quoted-Printable encoded string to bytes.
 * Handles soft line breaks (=\r\n or =\n).
 */
export function decodeQuotedPrintable(input: string): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input.charCodeAt(i);
    if (ch === 0x3d /* = */) {
      if (i + 1 < len && input.charCodeAt(i + 1) === 0x0d && i + 2 < len && input.charCodeAt(i + 2) === 0x0a) {
        // Soft line break =\r\n
        i += 3;
      } else if (i + 1 < len && input.charCodeAt(i + 1) === 0x0a) {
        // Soft line break =\n
        i += 2;
      } else if (i + 2 < len) {
        const hi = hexVal(input.charCodeAt(i + 1));
        const lo = hexVal(input.charCodeAt(i + 2));
        if (hi >= 0 && lo >= 0) {
          out.push((hi << 4) | lo);
          i += 3;
        } else {
          // Malformed =XX, output literal
          out.push(ch);
          i++;
        }
      } else {
        // Trailing =, output literal
        out.push(ch);
        i++;
      }
    } else {
      out.push(ch);
      i++;
    }
  }

  return new Uint8Array(out);
}

/**
 * Decode Quoted-Printable for RFC 2047 Q-encoding.
 * In Q-encoding, underscores represent spaces, and the rules
 * are slightly different from body QP.
 */
function decodeQEncoding(input: string): Uint8Array {
  const out: number[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input.charCodeAt(i);
    if (ch === 0x5f /* _ */) {
      out.push(0x20); // space
      i++;
    } else if (ch === 0x3d /* = */ && i + 2 < len) {
      const hi = hexVal(input.charCodeAt(i + 1));
      const lo = hexVal(input.charCodeAt(i + 2));
      if (hi >= 0 && lo >= 0) {
        out.push((hi << 4) | lo);
        i += 3;
      } else {
        out.push(ch);
        i++;
      }
    } else {
      out.push(ch);
      i++;
    }
  }

  return new Uint8Array(out);
}

// Cache TextDecoder instances per charset
const decoderCache = new Map<string, TextDecoder>();

/**
 * Decode bytes to string using the specified charset.
 * Falls back to UTF-8 on unknown charset.
 */
export function decodeCharset(data: Uint8Array, charset: string): string {
  const normalized = normalizeCharset(charset);
  let decoder = decoderCache.get(normalized);
  if (!decoder) {
    try {
      decoder = new TextDecoder(normalized);
    } catch {
      // Unknown charset, fall back to UTF-8
      decoder = new TextDecoder("utf-8", { fatal: false });
    }
    decoderCache.set(normalized, decoder);
  }
  return decoder.decode(data);
}

/**
 * Normalize charset names to values recognized by TextDecoder.
 */
function normalizeCharset(charset: string): string {
  const lower = charset.toLowerCase().trim();
  const aliases: Record<string, string> = {
    "us-ascii": "windows-1252",
    "ascii": "windows-1252",
    "latin1": "windows-1252",
    "latin-1": "windows-1252",
    "iso-8859-1": "windows-1252",
    "iso_8859-1": "windows-1252",
    "iso8859-1": "windows-1252",
    "iso88591": "windows-1252",
    "cp1252": "windows-1252",
    "x-sjis": "shift_jis",
    "sjis": "shift_jis",
    "shift-jis": "shift_jis",
    "ks_c_5601-1987": "euc-kr",
    "gb2312": "gbk",
    "gb_2312": "gbk",
  };
  return aliases[lower] ?? lower;
}

/**
 * Pattern matching RFC 2047 encoded words:
 *   =?charset?encoding?encoded_text?=
 * where encoding is B (base64) or Q (quoted-printable).
 *
 * Adjacent encoded words (possibly separated by linear whitespace)
 * must be concatenated without inserting space between them (RFC 2047 §6.2).
 */
const ENCODED_WORD_RE =
  /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

const ADJACENT_ENCODED_WORDS_RE =
  /=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+=\?)/g;

/**
 * Decode RFC 2047 encoded words in a header value.
 */
export function decodeRfc2047(input: string): string {
  if (!input.includes("=?")) return input;

  // Remove whitespace between adjacent encoded words (RFC 2047 §6.2)
  let processed = input.replace(ADJACENT_ENCODED_WORDS_RE, "=?$1?$2?$3?==?");

  // Keep replacing until stable (handles chains of 3+ encoded words)
  let prev: string;
  do {
    prev = processed;
    processed = processed.replace(
      ADJACENT_ENCODED_WORDS_RE,
      "=?$1?$2?$3?==?",
    );
  } while (processed !== prev);

  return processed.replace(
    ENCODED_WORD_RE,
    (_match, charset: string, encoding: string, text: string) => {
      const enc = encoding.toUpperCase();
      let bytes: Uint8Array;
      if (enc === "B") {
        bytes = decodeBase64(text);
      } else {
        bytes = decodeQEncoding(text);
      }
      return decodeCharset(bytes, charset);
    },
  );
}

/**
 * Apply Content-Transfer-Encoding decoding to raw part body.
 */
export function decodeTransferEncoding(
  data: Uint8Array,
  encoding: string,
): Uint8Array {
  switch (encoding.toLowerCase().trim()) {
    case "base64": {
      // Convert bytes to ASCII string for base64 decoding
      const str = new TextDecoder("ascii").decode(data);
      return decodeBase64(str);
    }
    case "quoted-printable": {
      const str = new TextDecoder("ascii").decode(data);
      return decodeQuotedPrintable(str);
    }
    case "7bit":
    case "8bit":
    case "binary":
    default:
      return data;
  }
}
