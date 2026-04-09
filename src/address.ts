/**
 * Email address parsing (RFC 5322 §3.4).
 */

import { decodeRfc2047 } from "./codec.ts";

export interface Address {
  /** Display name (decoded). Empty string if none. */
  readonly name: string;
  /** Email address (addr-spec). */
  readonly address: string;
}

export interface AddressGroup {
  /** Group display name. */
  readonly name: string;
  /** Addresses in the group. */
  readonly addresses: readonly Address[];
}

export type Mailbox = Address | AddressGroup;

/**
 * Check if a mailbox is a group.
 */
export function isGroup(m: Mailbox): m is AddressGroup {
  return "addresses" in m;
}

/**
 * Parse an address list header (From, To, Cc, etc.).
 * Returns flat list of addresses (groups are flattened).
 */
export function parseAddressList(input: string): Address[] {
  if (!input || input.trim() === "") return [];

  const decoded = decodeRfc2047(input);
  const result: Address[] = [];
  const mailboxes = splitAddresses(decoded);

  for (const raw of mailboxes) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    // Check for group syntax: "group-name: addr1, addr2 ;"
    const colonIdx = findGroupColon(trimmed);
    if (colonIdx >= 0) {
      const groupBody = trimmed.slice(colonIdx + 1).replace(/;[\s]*$/, "");
      const groupAddrs = splitAddresses(groupBody);
      for (const ga of groupAddrs) {
        const addr = parseSingleAddress(ga.trim());
        if (addr) result.push(addr);
      }
    } else {
      const addr = parseSingleAddress(trimmed);
      if (addr) result.push(addr);
    }
  }

  return result;
}

/**
 * Split comma-separated addresses, respecting quoted strings,
 * angle brackets, and group syntax (name:...;).
 */
function splitAddresses(input: string): string[] {
  const parts: string[] = [];
  let depth = 0; // angle bracket depth
  let inQuote = false;
  let inGroup = false;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "\\" && inQuote && i + 1 < input.length) {
      i++;
      continue;
    }

    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }

    if (inQuote) continue;

    if (ch === "<") {
      depth++;
    } else if (ch === ">") {
      if (depth > 0) depth--;
    } else if (ch === ":" && depth === 0 && !inGroup) {
      inGroup = true;
    } else if (ch === ";" && inGroup) {
      inGroup = false;
      parts.push(input.slice(start, i + 1));
      start = i + 1;
    } else if (ch === "," && depth === 0 && !inGroup) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail) {
    parts.push(input.slice(start));
  }

  return parts;
}

/**
 * Find the colon that indicates group syntax.
 * Returns -1 if not a group.
 * A group colon must not be inside angle brackets or quotes.
 */
function findGroupColon(input: string): number {
  // Pre-check: group syntax requires a semicolon somewhere in the string.
  // This avoids O(n²) from calling indexOf(";") per colon.
  if (input.indexOf(";") < 0) return -1;

  let inQuote = false;
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && inQuote) {
      i++;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === ":" && depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse a single mailbox: "Name <addr>" or "addr" or "<addr>".
 */
function parseSingleAddress(input: string): Address | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Look for angle-bracket address: ... <addr>
  const ltIdx = trimmed.lastIndexOf("<");
  const gtIdx = trimmed.indexOf(">", ltIdx >= 0 ? ltIdx : 0);

  if (ltIdx >= 0 && gtIdx > ltIdx) {
    const address = trimmed.slice(ltIdx + 1, gtIdx).trim();
    let name = trimmed.slice(0, ltIdx).trim();
    // Remove surrounding quotes from name
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    return { name, address };
  }

  // Bare address (no angle brackets)
  // Could be just "user@domain" or "(comment) user@domain"
  const commentMatch = trimmed.match(/^([^(]*)\(([^)]*)\)\s*$/);
  if (commentMatch) {
    return {
      name: commentMatch[2].trim(),
      address: commentMatch[1].trim(),
    };
  }

  // Plain addr-spec
  if (trimmed.includes("@")) {
    return { name: "", address: trimmed };
  }

  // Not a valid address, return as-is
  return { name: "", address: trimmed };
}
