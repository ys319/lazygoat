/**
 * mbox format parser with streaming support.
 *
 * Supports the mboxrd format (RFC 4155) where "From " lines at the start
 * of lines within message bodies are escaped by prepending ">".
 *
 * Two modes of operation:
 *   1. **Streaming (async iterator)**: Parse an mbox file/stream lazily,
 *      yielding one LazyMessage at a time. Memory-efficient for large files.
 *   2. **Eager**: Parse entire mbox string into an array of LazyMessages.
 *
 * The "From " separator line format (per RFC 4155):
 *   From sender@example.com Mon Jan  1 00:00:00 2024
 *   ^^^^^
 *   The key marker is "From " at the start of a line (or start of input).
 *
 * @module
 */

import { LazyMessage } from "./message.ts";

/**
 * Metadata extracted from the mbox "From " separator line.
 */
export interface MboxEnvelope {
  /** The sender address from the "From " line. */
  readonly sender: string;
  /** The timestamp string from the "From " line (may be empty). */
  readonly timestamp: string;
}

/**
 * A single message from an mbox file, with its envelope metadata.
 */
export interface MboxMessage {
  /** Envelope metadata from the "From " separator line. */
  readonly envelope: MboxEnvelope;
  /** The lazily-parsed email message. */
  readonly message: LazyMessage;
}

/**
 * Pattern matching the "From " separator line.
 * Must be at the start of a line (or input), followed by a non-newline character.
 * Format: "From " + sender + " " + date
 * Minimal match: "From " followed by anything to end of line.
 */
const FROM_LINE_RE = /^From /;

/**
 * Parse an mbox "From " separator line into envelope metadata.
 */
function parseFromLine(line: string): MboxEnvelope {
  // "From sender@example.com Mon Jan  1 00:00:00 2024"
  // "From MAILER-DAEMON Fri Jul  8 12:08:34 2005"
  const rest = line.slice(5); // Remove "From "
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx < 0) {
    return { sender: rest.trim(), timestamp: "" };
  }
  return {
    sender: rest.slice(0, spaceIdx),
    timestamp: rest.slice(spaceIdx + 1).trim(),
  };
}

/**
 * Unescape mboxrd quoting: lines starting with ">From " have one ">" removed.
 * This must be applied recursively — ">>From " becomes ">From ", etc.
 */
function unescapeMboxrd(raw: string): string {
  // Only process lines that start with one or more ">" followed by "From "
  // In mboxrd format, every ">" prefix before "From " at line start was added
  // during storage and should have exactly one ">" removed.
  return raw.replace(/^(>+)(From )/gm, (_match, arrows: string, from: string) => {
    return arrows.slice(1) + from;
  });
}

/**
 * Check if a line is an mbox "From " separator.
 * The line must start with "From " and be preceded by a blank line
 * (or be at the very start of input).
 */
function isFromLine(line: string): boolean {
  return FROM_LINE_RE.test(line);
}

// ── Synchronous (string) API ──

/**
 * Parse an entire mbox string into an array of MboxMessages.
 *
 * For large mbox files, prefer the streaming API (`parseMboxStream`).
 *
 * @example
 * ```ts
 * const messages = parseMbox(mboxString);
 * for (const { envelope, message } of messages) {
 *   console.log(envelope.sender, message.subject);
 * }
 * ```
 */
export function parseMbox(input: string): MboxMessage[] {
  const results: MboxMessage[] = [];
  const lines = input.split(/\r?\n/);

  let currentFromLine: string | null = null;
  let messageLines: string[] = [];
  let prevLineBlank = true; // Start of input counts as "after blank"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isFromLine(line) && prevLineBlank) {
      // Flush previous message
      if (currentFromLine !== null) {
        const raw = unescapeMboxrd(messageLines.join("\n"));
        results.push({
          envelope: parseFromLine(currentFromLine),
          message: new LazyMessage(raw),
        });
      }
      currentFromLine = line;
      messageLines = [];
      prevLineBlank = false;
    } else {
      messageLines.push(line);
      prevLineBlank = line === "";
    }
  }

  // Flush last message
  if (currentFromLine !== null) {
    // Remove trailing empty lines
    while (messageLines.length > 0 && messageLines[messageLines.length - 1] === "") {
      messageLines.pop();
    }
    const raw = unescapeMboxrd(messageLines.join("\n"));
    results.push({
      envelope: parseFromLine(currentFromLine),
      message: new LazyMessage(raw),
    });
  }

  return results;
}

// ── Streaming (async iterator) API ──

/**
 * Internal buffer for streaming mbox parsing.
 * Handles incremental line assembly from chunks.
 */
class LineBuffer {
  #buffer = "";

  /**
   * Add a chunk of data and return complete lines.
   * Incomplete lines are buffered for the next call.
   */
  push(chunk: string): string[] {
    this.#buffer += chunk;
    const lines: string[] = [];
    let start = 0;

    for (let i = 0; i < this.#buffer.length; i++) {
      if (this.#buffer[i] === "\n") {
        let end = i;
        // Strip \r if present (CRLF)
        if (end > start && this.#buffer[end - 1] === "\r") {
          end--;
        }
        lines.push(this.#buffer.slice(start, end));
        start = i + 1;
      }
    }

    // Keep remainder in buffer
    this.#buffer = this.#buffer.slice(start);
    return lines;
  }

  /**
   * Flush any remaining data as the final line.
   */
  flush(): string | null {
    if (this.#buffer.length === 0) return null;
    const line = this.#buffer;
    this.#buffer = "";
    return line;
  }
}

/**
 * Parse an mbox stream (ReadableStream<Uint8Array> or ReadableStream<string>)
 * as an async iterator of MboxMessages.
 *
 * Memory-efficient: only one message is buffered at a time.
 * Each yielded LazyMessage retains its full raw string (needed for lazy parsing),
 * but the mbox framing overhead is discarded.
 *
 * @example
 * ```ts
 * const file = await Deno.open("mailbox.mbox");
 * for await (const { envelope, message } of parseMboxStream(file.readable)) {
 *   console.log(envelope.sender, message.subject);
 *   // Each message is parsed lazily — accessing .text triggers full decode
 * }
 * ```
 */
export async function* parseMboxStream(
  stream: ReadableStream<Uint8Array> | ReadableStream<string>,
): AsyncGenerator<MboxMessage> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const lineBuffer = new LineBuffer();

  let currentFromLine: string | null = null;
  let messageLines: string[] = [];
  let prevLineBlank = true;

  function buildMessage(): MboxMessage | null {
    if (currentFromLine === null) return null;
    // Remove trailing empty lines
    while (messageLines.length > 0 && messageLines[messageLines.length - 1] === "") {
      messageLines.pop();
    }
    const raw = unescapeMboxrd(messageLines.join("\n"));
    return {
      envelope: parseFromLine(currentFromLine),
      message: new LazyMessage(raw),
    };
  }

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      const lines = lineBuffer.push(text);

      for (const line of lines) {
        if (isFromLine(line) && prevLineBlank) {
          // Flush previous message
          const msg = buildMessage();
          if (msg) yield msg;

          currentFromLine = line;
          messageLines = [];
          prevLineBlank = false;
        } else {
          messageLines.push(line);
          prevLineBlank = line === "";
        }
      }
    }

    // Handle any remaining data in the buffer
    const lastLine = lineBuffer.flush();
    if (lastLine !== null) {
      if (isFromLine(lastLine) && prevLineBlank) {
        const msg = buildMessage();
        if (msg) yield msg;
        currentFromLine = lastLine;
        messageLines = [];
      } else {
        messageLines.push(lastLine);
      }
    }

    // Flush final message
    const finalMsg = buildMessage();
    if (finalMsg) yield finalMsg;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Count the number of messages in an mbox file without fully parsing them.
 * Useful for progress reporting.
 */
export async function countMboxMessages(
  stream: ReadableStream<Uint8Array> | ReadableStream<string>,
): Promise<number> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const lineBuffer = new LineBuffer();
  let count = 0;
  let prevLineBlank = true;

  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      const lines = lineBuffer.push(text);

      for (const line of lines) {
        if (isFromLine(line) && prevLineBlank) {
          count++;
          prevLineBlank = false;
        } else {
          prevLineBlank = line === "";
        }
      }
    }

    const lastLine = lineBuffer.flush();
    if (lastLine !== null && isFromLine(lastLine) && prevLineBlank) {
      count++;
    }
  } finally {
    reader.releaseLock();
  }

  return count;
}
