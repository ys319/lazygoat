/**
 * Benchmarks for lazygoat email parser.
 *
 * Measures the cost of lazy vs eager evaluation by benchmarking
 * different access patterns.
 */

import { parse } from "./mod.ts";
import { parseMbox, parseMboxStream } from "./src/mbox.ts";

// ── Load test data ──

const simpleText = await Deno.readTextFile("testdata/basic/simple_text.eml");
const altEml = await Deno.readTextFile("testdata/multipart/alternative.eml");
const complexEml = await Deno.readTextFile("testdata/multipart/multipart/complex_b64_qp.eml");
const multipartMixed = await Deno.readTextFile("testdata/multipart/mixed.eml");
const nestedMultipart = await Deno.readTextFile(
  "testdata/multipart/nested.eml",
);

// Generate a large email for stress testing
function generateLargeEmail(partCount: number): string {
  const boundary = "LARGE-BOUNDARY-" + Math.random().toString(36).slice(2);
  let email = `From: sender@example.com\r\nTo: recipient@example.com\r\nSubject: Large email\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

  for (let i = 0; i < partCount; i++) {
    email += `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n`;
    email += `This is part ${i + 1} of the email. `.repeat(20) + "\r\n";
  }
  email += `--${boundary}--\r\n`;
  return email;
}

const largeEmail = generateLargeEmail(50);
const veryLargeEmail = generateLargeEmail(200);

// ── Construction (should be near-zero cost) ──

Deno.bench("parse() construction - simple", () => {
  parse(simpleText);
});

Deno.bench("parse() construction - multipart/complex_b64_qp.eml", () => {
  parse(complexEml);
});

Deno.bench("parse() construction - large (50 parts)", () => {
  parse(largeEmail);
});

Deno.bench("parse() construction - very large (200 parts)", () => {
  parse(veryLargeEmail);
});

// ── Subject only (headers parse + RFC 2047 decode) ──

Deno.bench("subject only - simple", () => {
  parse(simpleText).subject;
});

Deno.bench("subject only - multipart/alternative.eml (encoded)", () => {
  parse(altEml).subject;
});

Deno.bench("subject only - multipart/complex_b64_qp.eml (multi-line encoded)", () => {
  parse(complexEml).subject;
});

Deno.bench("subject only - large (50 parts)", () => {
  parse(largeEmail).subject;
});

// ── From address (headers + RFC 2047 + address parsing) ──

Deno.bench("from - simple", () => {
  parse(simpleText).from;
});

Deno.bench("from - multipart/alternative.eml (encoded Japanese)", () => {
  parse(altEml).from;
});

Deno.bench("from - multipart/complex_b64_qp.eml", () => {
  parse(complexEml).from;
});

// ── Text body (full decode path) ──

Deno.bench("text body - simple (7bit)", () => {
  parse(simpleText).text;
});

Deno.bench("text body - multipart/complex_b64_qp.eml (base64)", () => {
  parse(complexEml).text;
});

Deno.bench("text body - multipart/mixed.eml (nested alternative)", () => {
  parse(multipartMixed).text;
});

Deno.bench("text body - large (50 parts)", () => {
  parse(largeEmail).text;
});

// ── HTML body ──

Deno.bench("html body - multipart/alternative.eml", () => {
  parse(altEml).html;
});

Deno.bench("html body - multipart/complex_b64_qp.eml (quoted-printable)", () => {
  parse(complexEml).html;
});

// ── Attachments ──

Deno.bench("attachments - multipart/mixed.eml (1 PDF)", () => {
  parse(multipartMixed).attachments;
});

Deno.bench("attachments - multipart/nested.eml (txt + inline png)", () => {
  parse(nestedMultipart).attachments;
});

// ── Full parse (all properties) ──

Deno.bench("full parse - simple", () => {
  const msg = parse(simpleText);
  msg.subject;
  msg.from;
  msg.to;
  msg.date;
  msg.messageId;
  msg.text;
  msg.html;
  msg.attachments;
});

Deno.bench("full parse - multipart/complex_b64_qp.eml", () => {
  const msg = parse(complexEml);
  msg.subject;
  msg.from;
  msg.to;
  msg.date;
  msg.messageId;
  msg.text;
  msg.html;
  msg.attachments;
});

Deno.bench("full parse - multipart/mixed.eml", () => {
  const msg = parse(multipartMixed);
  msg.subject;
  msg.from;
  msg.to;
  msg.cc;
  msg.date;
  msg.messageId;
  msg.text;
  msg.html;
  msg.attachments;
});

Deno.bench("full parse - multipart/nested.eml", () => {
  const msg = parse(nestedMultipart);
  msg.subject;
  msg.from;
  msg.to;
  msg.date;
  msg.text;
  msg.html;
  msg.attachments;
  msg.inlineAttachments;
});

Deno.bench("full parse - large (50 parts)", () => {
  const msg = parse(largeEmail);
  msg.subject;
  msg.from;
  msg.to;
  msg.date;
  msg.text;
  msg.parts;
});

// ── Lazy advantage: repeated access (cache hit) ──

Deno.bench("cached access - subject x10", () => {
  const msg = parse(complexEml);
  for (let i = 0; i < 10; i++) {
    msg.subject;
  }
});

Deno.bench("cached access - text x10", () => {
  const msg = parse(complexEml);
  for (let i = 0; i < 10; i++) {
    msg.text;
  }
});

// ── Selective access (lazy advantage: skip unused parts) ──

Deno.bench("selective: only headers - large (50 parts)", () => {
  const msg = parse(largeEmail);
  msg.subject;
  msg.from;
  msg.to;
  msg.date;
  // Deliberately NOT accessing body/parts/attachments
});

Deno.bench("selective: only text - large (50 parts)", () => {
  const msg = parse(largeEmail);
  msg.text;
  // Deliberately NOT accessing headers/attachments
});

// ── mbox parsing ──

const testMbox = await Deno.readTextFile("testdata/mbox/test.mbox");

// Generate a large mbox for stress testing
function generateLargeMbox(count: number): string {
  let mbox = "";
  for (let i = 0; i < count; i++) {
    mbox += `From user${i}@example.com Mon Jan  1 00:00:00 2024\r\n`;
    mbox += `From: User ${i} <user${i}@example.com>\r\n`;
    mbox += `To: recipient@example.com\r\n`;
    mbox += `Subject: Message ${i}\r\n`;
    mbox += `Date: Mon, 1 Jan 2024 00:00:00 +0000\r\n`;
    mbox += `Message-ID: <msg${i}@example.com>\r\n`;
    mbox += `MIME-Version: 1.0\r\n`;
    mbox += `Content-Type: text/plain; charset="UTF-8"\r\n`;
    mbox += `\r\n`;
    mbox += `This is message number ${i}. `.repeat(5) + "\r\n";
    mbox += "\r\n";
  }
  return mbox;
}

const largeMbox = generateLargeMbox(100);
const veryLargeMbox = generateLargeMbox(1000);

Deno.bench("mbox parse - test.mbox (4 messages)", () => {
  parseMbox(testMbox);
});

Deno.bench("mbox parse - 100 messages", () => {
  parseMbox(largeMbox);
});

Deno.bench("mbox parse - 1000 messages", () => {
  parseMbox(veryLargeMbox);
});

Deno.bench("mbox parse + subject access - 100 messages", () => {
  const messages = parseMbox(largeMbox);
  for (const { message } of messages) {
    message.subject;
  }
});

Deno.bench("mbox stream parse - test.mbox (4 messages)", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(testMbox));
      controller.close();
    },
  });
  for await (const _ of parseMboxStream(stream)) {
    // Just iterate
  }
});

Deno.bench("mbox stream parse - 100 messages", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(largeMbox));
      controller.close();
    },
  });
  for await (const _ of parseMboxStream(stream)) {
    // Just iterate
  }
});
