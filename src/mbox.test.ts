/**
 * Tests for mbox parser (synchronous and streaming).
 */

import { assertEquals, assertExists } from "@std/assert";
import { parseMbox, parseMboxStream, countMboxMessages } from "./mbox.ts";

// ── Helper: create a ReadableStream from a string ──

function stringToStream(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

/**
 * Create a stream that emits data in small chunks to test buffering.
 */
function chunkedStream(input: string, chunkSize: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

// ── Load test data ──

const testMbox = await Deno.readTextFile("testdata/mbox/test.mbox");

// ── parseMbox (synchronous) ──

Deno.test("parseMbox - parses 4 messages from test.mbox", () => {
  const messages = parseMbox(testMbox);
  assertEquals(messages.length, 4);
});

Deno.test("parseMbox - first message envelope", () => {
  const messages = parseMbox(testMbox);
  assertEquals(messages[0].envelope.sender, "sender@example.com");
  assertEquals(messages[0].envelope.timestamp, "Mon Jan  1 00:00:00 2024");
});

Deno.test("parseMbox - first message content", () => {
  const messages = parseMbox(testMbox);
  const msg = messages[0].message;
  assertEquals(msg.subject, "First message");
  assertEquals(msg.from[0].address, "alice@example.com");
  assertEquals(msg.from[0].name, "Alice");
  assertEquals(msg.to[0].address, "bob@example.com");
  assertEquals(msg.messageId, "msg1@example.com");
  const text = msg.text;
  assertExists(text);
  assertEquals(text.includes("first message in the mbox"), true);
  assertEquals(text.includes("Best regards"), true);
});

Deno.test("parseMbox - second message (multipart/alternative)", () => {
  const messages = parseMbox(testMbox);
  const msg = messages[1].message;
  assertEquals(msg.subject, "Re: First message");
  assertEquals(msg.from[0].address, "bob@example.com");
  assertEquals(msg.inReplyTo, "msg1@example.com");
  const text = msg.text;
  assertExists(text);
  assertEquals(text.includes("Thanks for the message"), true);
  const html = msg.html;
  assertExists(html);
  assertEquals(html.includes("<p>Thanks for the message"), true);
});

Deno.test("parseMbox - third message (RFC 2047 encoded headers, base64 body)", () => {
  const messages = parseMbox(testMbox);
  const msg = messages[2].message;
  assertEquals(msg.subject, "テストメッセージ");
  assertEquals(msg.from[0].name, "チャーリー");
  assertEquals(msg.from[0].address, "charlie@example.com");
  const text = msg.text;
  assertExists(text);
  assertEquals(text.includes("テスト"), true);
});

Deno.test("parseMbox - fourth message (mboxrd >From escaping)", () => {
  const messages = parseMbox(testMbox);
  const msg = messages[3].message;
  assertEquals(msg.subject, "Message with From in body");
  const text = msg.text;
  assertExists(text);
  // ">From " should be unescaped to "From "
  assertEquals(text.includes("From the beginning"), true);
  // ">From my perspective" should also be unescaped
  assertEquals(text.includes("From my perspective"), true);
});

Deno.test("parseMbox - envelope metadata for all messages", () => {
  const messages = parseMbox(testMbox);
  assertEquals(messages[0].envelope.sender, "sender@example.com");
  assertEquals(messages[1].envelope.sender, "bob@example.com");
  assertEquals(messages[2].envelope.sender, "charlie@example.com");
  assertEquals(messages[3].envelope.sender, "dave@example.com");
});

// ── Edge cases ──

Deno.test("parseMbox - empty input", () => {
  const messages = parseMbox("");
  assertEquals(messages.length, 0);
});

Deno.test("parseMbox - single message", () => {
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: Single

Hello
`;
  const messages = parseMbox(mbox);
  assertEquals(messages.length, 1);
  assertEquals(messages[0].message.subject, "Single");
  assertEquals(messages[0].message.text, "Hello");
});

Deno.test("parseMbox - message without trailing newline", () => {
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: NoTrail

Body without trailing newline`;
  const messages = parseMbox(mbox);
  assertEquals(messages.length, 1);
  assertEquals(messages[0].message.text, "Body without trailing newline");
});

Deno.test("parseMbox - multiple >From escaping levels (mboxrd)", () => {
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: Escaped

Line one
>From someone (one level escaped)
>>From someone (two levels escaped)
`;
  const messages = parseMbox(mbox);
  const text = messages[0].message.text!;
  // One > removed from each level
  assertEquals(text.includes("From someone (one level escaped)"), true);
  assertEquals(text.includes(">From someone (two levels escaped)"), true);
});

Deno.test("parseMbox - From in body after non-blank line is not separator", () => {
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: Test

Some text
From me to you
More text
`;
  const messages = parseMbox(mbox);
  assertEquals(messages.length, 1);
  const text = messages[0].message.text!;
  assertEquals(text.includes("From me to you"), true);
});

// ── parseMboxStream (async) ──

Deno.test("parseMboxStream - parses same as synchronous", async () => {
  const stream = stringToStream(testMbox);
  const messages: Awaited<ReturnType<typeof parseMbox>> = [];
  for await (const msg of parseMboxStream(stream)) {
    messages.push(msg);
  }
  assertEquals(messages.length, 4);
  assertEquals(messages[0].message.subject, "First message");
  assertEquals(messages[1].message.subject, "Re: First message");
  assertEquals(messages[2].message.subject, "テストメッセージ");
  assertEquals(messages[3].message.subject, "Message with From in body");
});

Deno.test("parseMboxStream - small chunks (buffering test)", async () => {
  // Use tiny chunks to stress-test the line buffer
  const stream = chunkedStream(testMbox, 17);
  const messages: Awaited<ReturnType<typeof parseMbox>> = [];
  for await (const msg of parseMboxStream(stream)) {
    messages.push(msg);
  }
  assertEquals(messages.length, 4);
  assertEquals(messages[0].message.subject, "First message");
  assertEquals(messages[3].envelope.sender, "dave@example.com");
});

Deno.test("parseMboxStream - empty stream", async () => {
  const stream = stringToStream("");
  const messages = [];
  for await (const msg of parseMboxStream(stream)) {
    messages.push(msg);
  }
  assertEquals(messages.length, 0);
});

Deno.test("parseMboxStream - single message stream", async () => {
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: StreamTest

Hello from stream
`;
  const stream = stringToStream(mbox);
  const messages = [];
  for await (const msg of parseMboxStream(stream)) {
    messages.push(msg);
  }
  assertEquals(messages.length, 1);
  assertEquals(messages[0].message.subject, "StreamTest");
  assertEquals(messages[0].message.text, "Hello from stream");
});

Deno.test("parseMboxStream - lazy evaluation works per message", async () => {
  const stream = stringToStream(testMbox);
  let count = 0;
  for await (const { message } of parseMboxStream(stream)) {
    // Only access subject (should not trigger full MIME parsing)
    message.subject;
    count++;
  }
  assertEquals(count, 4);
});

// ── countMboxMessages ──

Deno.test("countMboxMessages - counts 4 messages", async () => {
  const stream = stringToStream(testMbox);
  const count = await countMboxMessages(stream);
  assertEquals(count, 4);
});

Deno.test("countMboxMessages - empty stream returns 0", async () => {
  const stream = stringToStream("");
  const count = await countMboxMessages(stream);
  assertEquals(count, 0);
});

Deno.test("countMboxMessages - single message", async () => {
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: One

Body
`;
  const stream = stringToStream(mbox);
  const count = await countMboxMessages(stream);
  assertEquals(count, 1);
});

// ── File-based streaming test ──

Deno.test("parseMboxStream - from real file handle", async () => {
  const file = await Deno.open("testdata/mbox/test.mbox", { read: true });
  const messages = [];
  for await (const msg of parseMboxStream(file.readable)) {
    messages.push(msg);
  }
  assertEquals(messages.length, 4);
  assertEquals(messages[0].message.subject, "First message");
  assertEquals(messages[2].message.from[0].name, "チャーリー");
});

// ── mboxrd round-trip: "From " in body doesn't break parsing ──

Deno.test("parseMbox - From at start of line after blank line with >From escaping", () => {
  // Simulate what an mbox writer would produce for a body containing "From "
  const mbox = `From user@example.com Mon Jan 1 00:00:00 2024
From: user@example.com
Subject: Tricky

First paragraph.

>From sender was the original line.
`;
  const messages = parseMbox(mbox);
  assertEquals(messages.length, 1);
  const text = messages[0].message.text!;
  assertEquals(text.includes("From sender was the original line"), true);
});
