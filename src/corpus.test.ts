/**
 * Integration tests using self-authored test email corpus.
 *
 * Tests verify structural parsing, field extraction, RFC 2047 decoding,
 * and MIME tree traversal across diverse email formats.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { parse } from "../mod.ts";

async function loadCorpus(filename: string): Promise<string> {
  return await Deno.readTextFile(`testdata/corpus/${filename}`);
}

// ── Plain text (no MIME headers) ──

Deno.test("corpus: plain text without MIME headers", async () => {
  const raw = await loadCorpus("plain_no_mime.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "Just a simple note");
  assertEquals(msg.from[0].address, "author@example.com");
  assertExists(msg.text);
  assert(msg.text!.includes("simple plain text"));
  assertEquals(msg.html, null);
  assertEquals(msg.attachments.length, 0);
});

// ── HTML-only with quoted-printable ──

Deno.test("corpus: HTML-only email with quoted-printable encoding", async () => {
  const raw = await loadCorpus("html_qp.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "HTML Newsletter - Special Edition");
  assertExists(msg.html);
  assert(msg.html!.includes("Héllo"), "QP decoding should produce é");
  assert(msg.html!.includes("Über"), "QP decoding should produce Ü");
  assert(msg.html!.includes("<h1>"), "Should contain HTML tags");
  assertEquals(msg.text, null);
  assertEquals(msg.attachments.length, 0);
});

// ── multipart/alternative ──

Deno.test("corpus: multipart/alternative with text and HTML parts", async () => {
  const raw = await loadCorpus("alt_text_html.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "Multipart Alternative Test");
  assertEquals(msg.from[0].name, "Test Sender");
  assertEquals(msg.to[0].address, "recipient@example.com");
  assertExists(msg.text);
  assertExists(msg.html);
  assert(msg.text!.includes("plain text version"));
  assert(msg.html!.includes("<strong>HTML version</strong>"));
  assertEquals(msg.attachments.length, 0);
});

// ── multipart/mixed with attachment ──

Deno.test("corpus: multipart/mixed with PDF attachment", async () => {
  const raw = await loadCorpus("mixed_attachment.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "Email with attachment");
  assertEquals(msg.from[0].name, "Alice Smith");
  assertExists(msg.text);
  assert(msg.text!.includes("attached document"));
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.attachments[0].mimeType, "application/pdf");
  assertEquals(msg.attachments[0].filename, "document.pdf");
});

// ── nested multipart with cid: inline image ──

Deno.test("corpus: nested multipart with inline cid: image and attachment", async () => {
  const raw = await loadCorpus("nested_cid.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "Testing nested MIME with cid");
  assertExists(msg.text);
  assertExists(msg.html);
  assert(
    msg.html!.includes("cid:logo@example.com"),
    "HTML should reference inline image by cid:",
  );
  assert(msg.inlineAttachments.length >= 1, "Should have inline image");
  assertEquals(msg.inlineAttachments[0].mimeType, "image/png");
  assertExists(msg.inlineAttachments[0].contentId);
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.attachments[0].mimeType, "application/pdf");
});

// ── ISO-8859-1 RFC 2047 Q-encoded headers and QP body ──

Deno.test("corpus: ISO-8859-1 headers (RFC 2047 Q-encoding) and QP body", async () => {
  const raw = await loadCorpus("iso8859_qp.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "Réunion d'équipe");
  assertEquals(msg.from[0].name, "François Martin");
  assertExists(msg.text);
  assert(
    msg.text!.includes("réunion"),
    "Body should be decoded from ISO-8859-1",
  );
  assert(msg.text!.includes("François"), "Body should include decoded ç");
});

// ── Japanese email with UTF-8 B-encoded headers and base64 body ──

Deno.test("corpus: Japanese email with UTF-8 B-encoded headers and base64 body", async () => {
  const raw = await loadCorpus("japanese_b64.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "テスト");
  assertEquals(msg.from[0].name, "山田太郎");
  assertExists(msg.text);
  assert(
    msg.text!.includes("テスト"),
    "Base64 body should decode to Japanese text",
  );
});

// ── S/MIME signed (multipart/signed) ──

Deno.test("corpus: S/MIME signed email (multipart/signed)", async () => {
  const raw = await loadCorpus("smime_signed.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "Signed Message");
  assertExists(msg.text);
  assert(msg.text!.includes("This message is digitally signed"));
  assert(msg.parts.length >= 2, "Should have message + signature parts");
});

// ── multipart/related with inline cid: image ──

Deno.test("corpus: multipart/related with inline cid: image", async () => {
  const raw = await loadCorpus("related_inline.eml");
  const msg = parse(raw);
  assertEquals(msg.subject, "HTML Email with Inline Image");
  assertExists(msg.html);
  assert(msg.html!.includes("cid:banner@example.com"));
  assert(msg.inlineAttachments.length >= 1);
  assertEquals(msg.inlineAttachments[0].mimeType, "image/png");
  assertExists(msg.inlineAttachments[0].contentId);
});

// ── Malformed/edge-case email ──

Deno.test("corpus: malformed/edge-case email parses without crash", async () => {
  const raw = await loadCorpus("malformed.eml");
  const msg = parse(raw);
  // Should not throw; access all lazy properties
  msg.subject;
  msg.from;
  msg.to;
  msg.cc;
  msg.date;
  msg.messageId;
  msg.text;
  msg.html;
  msg.attachments;
  msg.inlineAttachments;
  msg.parts;
  msg.headers;
});

// ── All corpus files parse without error ──

Deno.test("corpus: all files parse without error", async () => {
  const corpusDir = "testdata/corpus";
  let count = 0;
  for await (const entry of Deno.readDir(corpusDir)) {
    if (!entry.isFile) continue;
    const raw = await Deno.readTextFile(`${corpusDir}/${entry.name}`);
    const msg = parse(raw);
    msg.subject;
    msg.from;
    msg.to;
    msg.cc;
    msg.date;
    msg.messageId;
    msg.text;
    msg.html;
    msg.attachments;
    msg.inlineAttachments;
    msg.parts;
    msg.headers;
    count++;
  }
  assert(count >= 10, `Expected at least 10 corpus files, got ${count}`);
});

// ── Lazy evaluation: construction cost is zero ──

Deno.test("corpus: lazy construction - properties compute on demand", async () => {
  // Complex nested email: only accessed properties should be parsed
  const raw = await loadCorpus("nested_cid.eml");
  const msg = parse(raw);
  // Accessing subject triggers only header parsing
  const subject = msg.subject;
  assertEquals(subject, "Testing nested MIME with cid");
  // Accessing html triggers full MIME tree traversal
  const html = msg.html;
  assertExists(html);
});
