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
  let current = "";

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "\\" && inQuote && i + 1 < input.length) {
      current += ch + input[i + 1];
      i++;
      continue;
    }

    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }

    if (inQuote) {
      current += ch;
      continue;
    }

    if (ch === "<") {
      depth++;
      current += ch;
    } else if (ch === ">") {
      if (depth > 0) depth--;
      current += ch;
    } else if (ch === ":" && depth === 0 && !inGroup) {
      // Start of group syntax
      inGroup = true;
      current += ch;
    } else if (ch === ";" && inGroup) {
      // End of group syntax
      inGroup = false;
      current += ch;
      parts.push(current);
      current = "";
    } else if (ch === "," && depth === 0 && !inGroup) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

/**
 * Find the colon that indicates group syntax.
 * Returns -1 if not a group.
 * A group colon must not be inside angle brackets or quotes.
 */
function findGroupColon(input: string): number {
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
      // Check that there's a ";" somewhere after — this distinguishes
      // group syntax from display names that happen to contain colons
      if (input.indexOf(";", i + 1) >= 0) {
        return i;
      }
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
