/**
 * Lazy email header parsing (RFC 5322 §2.2).
 *
 * Headers are split into raw fields on first access.
 * Individual values are decoded (RFC 2047 unfolding) only when read.
 */

import { decodeRfc2047 } from "./codec.ts";

/** A raw header field before value decoding. */
interface RawField {
  /** Original field name (preserving case). */
  name: string;
  /** Raw value (folded, may contain encoded words). */
  rawValue: string;
}

/**
 * Lazy header map.
 *
 * Stores raw header bytes and parses/decodes on demand:
 *   1. Raw bytes → field list (on first access to any header)
 *   2. Per-field value decoding (on access to specific header)
 */
export class HeaderMap {
  #rawSection: string;
  #fields: RawField[] | undefined;
  #decoded = new Map<number, string>();

  constructor(rawSection: string) {
    this.#rawSection = rawSection;
  }

  /**
   * Get the decoded value of the first header with the given name.
   * Header name matching is case-insensitive.
   */
  get(name: string): string | null {
    const lower = name.toLowerCase();
    const fields = this.#ensureFields();
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].name.toLowerCase() === lower) {
        return this.#decodeField(i);
      }
    }
    return null;
  }

  /**
   * Get all decoded values for headers with the given name.
   */
  getAll(name: string): string[] {
    const lower = name.toLowerCase();
    const fields = this.#ensureFields();
    const result: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].name.toLowerCase() === lower) {
        result.push(this.#decodeField(i));
      }
    }
    return result;
  }

  /**
   * Check if a header exists.
   */
  has(name: string): boolean {
    const lower = name.toLowerCase();
    return this.#ensureFields().some((f) => f.name.toLowerCase() === lower);
  }

  /**
   * Iterate over all header name-value pairs.
   * Values are decoded on iteration.
   */
  *entries(): IterableIterator<[string, string]> {
    const fields = this.#ensureFields();
    for (let i = 0; i < fields.length; i++) {
      yield [fields[i].name, this.#decodeField(i)];
    }
  }

  /**
   * Iterate over all header names (preserving case and duplicates).
   */
  *keys(): IterableIterator<string> {
    for (const f of this.#ensureFields()) {
      yield f.name;
    }
  }

  /**
   * Get the number of header fields.
   */
  get size(): number {
    return this.#ensureFields().length;
  }

  /**
   * Ensure the raw header section is parsed into fields.
   * This is the first level of lazy evaluation.
   */
  #ensureFields(): RawField[] {
    if (this.#fields === undefined) {
      this.#fields = splitHeaderFields(this.#rawSection);
    }
    return this.#fields;
  }

  /**
   * Decode a specific field's value.
   * This is the second level of lazy evaluation.
   */
  #decodeField(index: number): string {
    let decoded = this.#decoded.get(index);
    if (decoded === undefined) {
      const raw = this.#fields![index].rawValue;
      // Unfold (remove CRLF + WSP continuations)
      const unfolded = raw.replace(/\r?\n[ \t]/g, " ");
      // Decode RFC 2047 encoded words
      decoded = decodeRfc2047(unfolded.trim());
      this.#decoded.set(index, decoded);
    }
    return decoded;
  }
}

/**
 * Split raw header text into field entries.
 * Each field starts at the beginning of a line with a non-whitespace character.
 * Continuation lines start with whitespace (folding).
 */
function splitHeaderFields(raw: string): RawField[] {
  const fields: RawField[] = [];

  // Split into lines
  const lines = raw.split(/\r?\n/);
  let currentName = "";
  let currentValue = "";

  for (const line of lines) {
    if (line === "") continue;

    if (line[0] === " " || line[0] === "\t") {
      // Continuation line
      if (currentName) {
        currentValue += "\r\n" + line;
      }
    } else {
      // New field - save previous if exists
      if (currentName) {
        fields.push({ name: currentName, rawValue: currentValue });
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        currentName = line.slice(0, colonIdx);
        currentValue = line.slice(colonIdx + 1);
      } else {
        // Malformed header line - treat as value of previous
        if (currentName) {
          currentValue += "\r\n" + line;
        }
        currentName = "";
        currentValue = "";
      }
    }
  }

  // Save last field
  if (currentName) {
    fields.push({ name: currentName, rawValue: currentValue });
  }

  return fields;
}
