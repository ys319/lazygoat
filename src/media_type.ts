/**
 * Content-Type / media type parsing (RFC 2045 §5).
 */

import { decodeCharset } from "./codec.ts";

export interface MediaType {
  /** e.g. "text", "multipart" */
  readonly type: string;
  /** e.g. "plain", "html", "mixed" */
  readonly subtype: string;
  /** Parameter map (lowercase keys). */
  readonly params: ReadonlyMap<string, string>;
}

const DEFAULT_MEDIA_TYPE: MediaType = Object.freeze({
  type: "text",
  subtype: "plain",
  params: new Map<string, string>(),
});

/**
 * Parse a Content-Type header value.
 *
 *   text/plain; charset="UTF-8"; format=flowed
 *   multipart/alternative; boundary="----=_Part"
 */
export function parseMediaType(input: string | undefined): MediaType {
  if (!input) return DEFAULT_MEDIA_TYPE;

  const trimmed = input.trim();
  if (trimmed === "") return DEFAULT_MEDIA_TYPE;

  // Find type/subtype portion (everything before first ';')
  const semiIdx = trimmed.indexOf(";");
  const typePart = semiIdx >= 0 ? trimmed.slice(0, semiIdx) : trimmed;
  const slashIdx = typePart.indexOf("/");
  if (slashIdx < 0) {
    return {
      type: typePart.trim().toLowerCase(),
      subtype: "",
      params: new Map(),
    };
  }

  const type = typePart.slice(0, slashIdx).trim().toLowerCase();
  const subtype = typePart.slice(slashIdx + 1).trim().toLowerCase();

  // Parse parameters
  const params = new Map<string, string>();
  if (semiIdx >= 0) {
    parseParams(trimmed.slice(semiIdx + 1), params);
  }

  return { type, subtype, params };
}

/**
 * Parse semicolon-separated parameters into a map.
 * Handles quoted strings and RFC 2231 continuations (basic).
 */
function parseParams(input: string, out: Map<string, string>): void {
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Skip whitespace and semicolons
    while (i < len && (input[i] === " " || input[i] === "\t" || input[i] === ";" || input[i] === "\r" || input[i] === "\n")) {
      i++;
    }
    if (i >= len) break;

    // Read parameter name
    const nameStart = i;
    while (i < len && input[i] !== "=" && input[i] !== ";" && input[i] !== " ") {
      i++;
    }
    const name = input.slice(nameStart, i).trim().toLowerCase();
    if (name === "") break;

    // Skip whitespace
    while (i < len && (input[i] === " " || input[i] === "\t")) i++;

    if (i >= len || input[i] !== "=") {
      // No value, just a flag parameter
      out.set(name, "");
      continue;
    }
    i++; // skip '='

    // Skip whitespace
    while (i < len && (input[i] === " " || input[i] === "\t")) i++;

    let value: string;
    if (i < len && input[i] === '"') {
      // Quoted string
      i++; // skip opening quote
      let buf = "";
      while (i < len && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < len) {
          i++;
          buf += input[i];
        } else {
          buf += input[i];
        }
        i++;
      }
      if (i < len) i++; // skip closing quote
      value = buf;
    } else {
      // Token value (unquoted)
      const valStart = i;
      while (i < len && input[i] !== ";" && input[i] !== " " && input[i] !== "\t") {
        i++;
      }
      value = input.slice(valStart, i).trim();
    }

    // Handle RFC 2231 charset/language encoding: name*=charset'language'value
    if (name.endsWith("*")) {
      const baseName = name.slice(0, -1);
      const aposIdx = value.indexOf("'");
      if (aposIdx >= 0) {
        const charset = value.slice(0, aposIdx);
        const aposIdx2 = value.indexOf("'", aposIdx + 1);
        if (aposIdx2 >= 0) {
          const encoded = value.slice(aposIdx2 + 1);
          value = decodeRfc2231Value(encoded, charset);
        }
      }
      out.set(baseName, value);
    } else {
      out.set(name, value);
    }
  }
}

/**
 * Decode RFC 2231 percent-encoded value.
 */
function decodeRfc2231Value(encoded: string, charset: string): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < encoded.length) {
    if (encoded[i] === "%" && i + 2 < encoded.length) {
      const hex = encoded.slice(i + 1, i + 3);
      const val = parseInt(hex, 16);
      if (!isNaN(val)) {
        bytes.push(val);
        i += 3;
        continue;
      }
    }
    bytes.push(encoded.charCodeAt(i));
    i++;
  }

  const cs = charset || "utf-8";
  return decodeCharset(new Uint8Array(bytes), cs);
}

/**
 * Format a media type as "type/subtype".
 */
export function formatMediaType(mt: MediaType): string {
  return `${mt.type}/${mt.subtype}`;
}
