import { assertEquals, assertExists } from "@std/assert";
import { parse, parseEager } from "./mod.ts";
import { MimePart } from "./src/part.ts";

// ── Helper ──

async function loadEml(name: string): Promise<string> {
  return await Deno.readTextFile(`${Deno.cwd()}/testdata/${name}`);
}

async function loadEmlBytes(name: string): Promise<Uint8Array> {
  return await Deno.readFile(`${Deno.cwd()}/testdata/${name}`);
}

// ── Lazy evaluation ──

Deno.test("parse - construction does zero parsing", () => {
  // This should not throw even with garbage input
  const msg = parse("not a valid email at all");
  assertExists(msg);
});

Deno.test("parse - accepts Uint8Array", async () => {
  const bytes = await loadEmlBytes("basic/simple_text.eml");
  const msg = parse(bytes);
  assertEquals(msg.subject, "Simple plain text");
});

// ── simple_text.eml ──

Deno.test("basic/simple_text.eml -subject", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.subject, "Simple plain text");
});

Deno.test("basic/simple_text.eml -from", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].address, "sender@example.com");
});

Deno.test("basic/simple_text.eml -to", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.to.length, 1);
  assertEquals(msg.to[0].address, "recipient@example.com");
});

Deno.test("basic/simple_text.eml -date", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertExists(msg.date);
  assertEquals(msg.date!.getUTCFullYear(), 2024);
});

Deno.test("basic/simple_text.eml -messageId", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.messageId, "simple@example.com");
});

Deno.test("basic/simple_text.eml -text body", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertExists(msg.text);
  assertEquals(msg.text!.includes("Hello, World!"), true);
  assertEquals(msg.text!.includes("simple plain text email"), true);
});

Deno.test("basic/simple_text.eml -no html", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.html, null);
});

Deno.test("basic/simple_text.eml -no attachments", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.attachments.length, 0);
});

// ── multipart_alternative.eml (multipart/alternative with RFC 2047) ──

Deno.test("multipart/alternative.eml -subject", async () => {
  const msg = parse(await loadEml("multipart/alternative.eml"));
  assertEquals(msg.subject, "TEST");
});

Deno.test("multipart/alternative.eml -from with RFC 2047", async () => {
  const msg = parse(await loadEml("multipart/alternative.eml"));
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].name, "田中一郎");
  assertEquals(msg.from[0].address, "tanaka@example.com");
});

Deno.test("multipart/alternative.eml -to", async () => {
  const msg = parse(await loadEml("multipart/alternative.eml"));
  assertEquals(msg.to.length, 1);
  assertEquals(msg.to[0].address, "user@example.com");
});

Deno.test("multipart/alternative.eml -html body", async () => {
  const msg = parse(await loadEml("multipart/alternative.eml"));
  assertExists(msg.html);
  assertEquals(msg.html!.includes("<div"), true);
});

Deno.test("multipart/alternative.eml -date", async () => {
  const msg = parse(await loadEml("multipart/alternative.eml"));
  assertExists(msg.date);
  assertEquals(msg.date!.getUTCFullYear(), 2024);
});

// ── complex_b64_qp.eml (complex multipart with base64 + QP) ──

Deno.test("multipart/complex_b64_qp.eml -subject (multi-line RFC 2047)", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertEquals(msg.subject, "サービスからのお知らせ - データエクスポート完了");
});

Deno.test("multipart/complex_b64_qp.eml -from", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].name, "Example データエクスポート");
  assertEquals(msg.from[0].address, "noreply@example.com");
});

Deno.test("multipart/complex_b64_qp.eml -to", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertEquals(msg.to.length, 1);
  assertEquals(msg.to[0].address, "user@example.com");
});

Deno.test("multipart/complex_b64_qp.eml -text body (base64 decoded)", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertExists(msg.text);
  // The base64-decoded text should contain Japanese
  assertEquals(msg.text!.includes("お使いのアカウント"), true);
  assertEquals(msg.text!.includes("データ"), true);
});

Deno.test("multipart/complex_b64_qp.eml -html body (QP decoded)", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertExists(msg.html);
  assertEquals(msg.html!.includes("お使いのアカウント"), true);
  assertEquals(msg.html!.includes("Example logo"), true);
});

Deno.test("multipart/complex_b64_qp.eml -messageId", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertEquals(msg.messageId, "notification-001@example.com");
});

// ── multipart_mixed.eml ──

Deno.test("multipart/mixed.eml -subject", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertEquals(msg.subject, "Email with attachment");
});

Deno.test("multipart/mixed.eml -from", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].name, "Alice Smith");
  assertEquals(msg.from[0].address, "alice@example.com");
});

Deno.test("multipart/mixed.eml -to (multiple)", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertEquals(msg.to.length, 2);
  assertEquals(msg.to[0].address, "bob@example.com");
  assertEquals(msg.to[1].name, "Charlie Brown");
  assertEquals(msg.to[1].address, "charlie@example.com");
});

Deno.test("multipart/mixed.eml -cc", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertEquals(msg.cc.length, 1);
  assertEquals(msg.cc[0].address, "dave@example.com");
});

Deno.test("multipart/mixed.eml -text body", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertExists(msg.text);
  assertEquals(msg.text!.includes("Hello Bob and Charlie"), true);
  assertEquals(msg.text!.includes("attachment"), true);
});

Deno.test("multipart/mixed.eml -html body", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertExists(msg.html);
  assertEquals(msg.html!.includes("<html>"), true);
  assertEquals(msg.html!.includes("Hello Bob and Charlie"), true);
});

Deno.test("multipart/mixed.eml -attachment", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.attachments[0].filename, "report.pdf");
  assertEquals(msg.attachments[0].mimeType, "application/pdf");
  // Content should be base64-decoded (PDF header)
  const content = msg.attachments[0].content;
  const header = new TextDecoder().decode(content.slice(0, 5));
  assertEquals(header, "%PDF-");
});

// ── encoded_headers.eml ──

Deno.test("headers/encoded.eml -decoded from", async () => {
  const msg = parse(await loadEml("headers/encoded.eml"));
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].name, "山田太郎");
  assertEquals(msg.from[0].address, "yamada@example.jp");
});

Deno.test("headers/encoded.eml -decoded to", async () => {
  const msg = parse(await loadEml("headers/encoded.eml"));
  assertEquals(msg.to.length, 1);
  assertEquals(msg.to[0].name, "佐藤花子");
  assertEquals(msg.to[0].address, "sato@example.jp");
});

Deno.test("headers/encoded.eml -decoded subject", async () => {
  const msg = parse(await loadEml("headers/encoded.eml"));
  assertEquals(msg.subject, "お知らせ");
});

// ── nested_multipart.eml ──

Deno.test("multipart/nested.eml -text body through nested structure", async () => {
  const msg = parse(await loadEml("multipart/nested.eml"));
  assertExists(msg.text);
  assertEquals(msg.text!.includes("Check out this image!"), true);
});

Deno.test("multipart/nested.eml -html body through nested structure", async () => {
  const msg = parse(await loadEml("multipart/nested.eml"));
  assertExists(msg.html);
  assertEquals(msg.html!.includes('<img src="cid:img001"'), true);
});

Deno.test("multipart/nested.eml -attachment", async () => {
  const msg = parse(await loadEml("multipart/nested.eml"));
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.attachments[0].filename, "notes.txt");
});

Deno.test("multipart/nested.eml -inline image", async () => {
  const msg = parse(await loadEml("multipart/nested.eml"));
  assertEquals(msg.inlineAttachments.length, 1);
  assertEquals(msg.inlineAttachments[0].contentId, "img001");
  assertEquals(msg.inlineAttachments[0].mimeType, "image/png");
  // Should be base64-decoded PNG
  const content = msg.inlineAttachments[0].content;
  // PNG magic bytes: 0x89 0x50 0x4E 0x47
  assertEquals(content[0], 0x89);
  assertEquals(content[1], 0x50);
  assertEquals(content[2], 0x4e);
  assertEquals(content[3], 0x47);
});

// ── qp_body.eml ──

Deno.test("encoding/qp_body.eml -QP decoded body", async () => {
  const msg = parse(await loadEml("encoding/qp_body.eml"));
  assertExists(msg.text);
  assertEquals(msg.text!.includes("こんにちは世界！"), true);
  // Soft line break should be removed
  assertEquals(msg.text!.includes("encoding to ensure"), true);
  // Encoded special characters
  assertEquals(msg.text!.includes("= equals"), true);
});

// ── base64_body.eml ──

Deno.test("encoding/base64_body.eml -base64 decoded body", async () => {
  const msg = parse(await loadEml("encoding/base64_body.eml"));
  assertExists(msg.text);
  assertEquals(msg.text!.includes("これはBase64でエンコードされた本文です"), true);
  assertEquals(msg.text!.includes("Hello from Base64!"), true);
});

// ── no_mime.eml ──

Deno.test("basic/no_mime.eml -legacy email without MIME headers", async () => {
  const msg = parse(await loadEml("basic/no_mime.eml"));
  assertEquals(msg.subject, "No MIME headers");
  assertExists(msg.text);
  assertEquals(msg.text!.includes("legacy email"), true);
});

// ── folded_headers.eml ──

Deno.test("headers/folded.eml -long folded subject", async () => {
  const msg = parse(await loadEml("headers/folded.eml"));
  assertEquals(
    msg.subject.includes("very long subject line"),
    true,
  );
  assertEquals(
    msg.subject.includes("header field folding"),
    true,
  );
});

Deno.test("headers/folded.eml -multiple Received headers", async () => {
  const msg = parse(await loadEml("headers/folded.eml"));
  const received = msg.headers.getAll("received");
  assertEquals(received.length, 2);
  assertEquals(received[0].includes("mail.example.com"), true);
  assertEquals(received[1].includes("localhost"), true);
});

// ── complex_addresses.eml ──

Deno.test("headers/complex_addresses.eml -quoted name with escape", async () => {
  const msg = parse(await loadEml("headers/complex_addresses.eml"));
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].name, 'John "JD" Doe');
  assertEquals(msg.from[0].address, "john@example.com");
});

Deno.test("headers/complex_addresses.eml -undisclosed recipients", async () => {
  const msg = parse(await loadEml("headers/complex_addresses.eml"));
  assertEquals(msg.to.length, 0);
});

Deno.test("headers/complex_addresses.eml -mixed Cc addresses", async () => {
  const msg = parse(await loadEml("headers/complex_addresses.eml"));
  assertEquals(msg.cc.length, 3);
  assertEquals(msg.cc[0].name, "山田太郎");
  assertEquals(msg.cc[0].address, "yamada@example.jp");
  assertEquals(msg.cc[1].address, "plain@example.com");
  assertEquals(msg.cc[2].name, "Alice, Bob");
});

Deno.test("headers/complex_addresses.eml -reply-to", async () => {
  const msg = parse(await loadEml("headers/complex_addresses.eml"));
  assertEquals(msg.replyTo.length, 1);
  assertEquals(msg.replyTo[0].address, "reply@example.com");
});

Deno.test("headers/complex_addresses.eml -in-reply-to", async () => {
  const msg = parse(await loadEml("headers/complex_addresses.eml"));
  assertEquals(msg.inReplyTo, "original@example.com");
});

Deno.test("headers/complex_addresses.eml -references", async () => {
  const msg = parse(await loadEml("headers/complex_addresses.eml"));
  assertEquals(msg.references.length, 2);
  assertEquals(msg.references[0], "first@example.com");
  assertEquals(msg.references[1], "second@example.com");
});

// ── Parts access ──

Deno.test("parts - flat part list for simple message", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.parts.length, 1);
  assertEquals(msg.parts[0].contentType.type, "text");
  assertEquals(msg.parts[0].contentType.subtype, "plain");
});

Deno.test("parts - flat part list for multipart message", async () => {
  const msg = parse(await loadEml("multipart/mixed.eml"));
  // text/plain + text/html + application/pdf = 3 leaf parts
  assertEquals(msg.parts.length, 3);
});

Deno.test("parts - nested multipart flattened", async () => {
  const msg = parse(await loadEml("multipart/nested.eml"));
  // text/plain + text/html + image/png + text/plain(notes.txt) = 4 leaf parts
  assertEquals(msg.parts.length, 4);
});

// ── MIME Version ──

Deno.test("mimeVersion", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.mimeVersion, "1.0");
});

// ── Headers access ──

Deno.test("headers - custom header access", async () => {
  const msg = parse(await loadEml("multipart/complex_b64_qp.eml"));
  assertExists(msg.headers.get("dkim-signature"));
  assertExists(msg.headers.get("x-spam-status"));
});

// ── Edge cases ──

Deno.test("edge case - headers only (no body)", () => {
  const msg = parse("Subject: test\r\nFrom: a@b.com");
  assertEquals(msg.subject, "test");
  assertEquals(msg.text, null);
});

Deno.test("edge case - empty body", () => {
  const msg = parse("Subject: test\r\n\r\n");
  assertEquals(msg.subject, "test");
});

Deno.test("edge case - bcc (not present)", async () => {
  const msg = parse(await loadEml("basic/simple_text.eml"));
  assertEquals(msg.bcc.length, 0);
});

Deno.test("edge case - content type access", async () => {
  const msg = parse(await loadEml("multipart/alternative.eml"));
  assertEquals(msg.contentType.type, "multipart");
  assertEquals(msg.contentType.subtype, "alternative");
  assertExists(msg.contentType.params.get("boundary"));
});

// ── Unclosed quote in Content-Disposition filename ──

Deno.test("edge case - unclosed quote in Content-Disposition filename", () => {
  const headers = `Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="broken`;
  const body = new TextEncoder().encode("data");
  const part = new MimePart(headers, body);
  assertEquals(part.filename, "broken");
});

Deno.test("edge case - unclosed quote with semicolon after", () => {
  const headers = `Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="broken; other=val`;
  const body = new TextEncoder().encode("data");
  const part = new MimePart(headers, body);
  assertEquals(part.filename, "broken");
});

// ── parseEager ──

Deno.test("parseEager - simple text email", async () => {
  const raw = await loadEml("basic/simple_text.eml");
  const msg = parseEager(raw);
  assertEquals(msg.subject, "Simple plain text");
  assertEquals(msg.from.length, 1);
  assertEquals(msg.from[0].address, "sender@example.com");
  assertEquals(msg.to.length, 1);
  assertExists(msg.text);
  assertEquals(msg.html, null);
  assertEquals(msg.attachments.length, 0);
  assertEquals(msg.messageId, "simple@example.com");
  assertExists(msg.date);
  assertEquals(msg.mimeVersion, "1.0");
  // Headers should be available as array
  assertEquals(msg.headers.length > 0, true);
  // Root part should be resolved
  assertEquals(msg.rootPart.contentType.type, "text");
  assertEquals(msg.rootPart.contentType.subtype, "plain");
  assertEquals(msg.parts.length, 1);
});

Deno.test("parseEager - multipart email structure", async () => {
  const raw = await loadEml("multipart/mixed.eml");
  const msg = parseEager(raw);
  assertEquals(msg.subject, "Email with attachment");
  assertEquals(msg.contentType.type, "multipart");
  // Root part should have children
  assertEquals(msg.rootPart.isMultipart, true);
  assertEquals(msg.rootPart.parts.length > 0, true);
  // Leaf parts should be flattened
  assertEquals(msg.parts.length, 3);
  // Attachments resolved
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.attachments[0].filename, "report.pdf");
});

Deno.test("parseEager - nested multipart with full tree", async () => {
  const raw = await loadEml("multipart/nested.eml");
  const msg = parseEager(raw);
  assertExists(msg.text);
  assertExists(msg.html);
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.inlineAttachments.length, 1);
  assertEquals(msg.parts.length, 4);
  // Verify tree structure is fully resolved
  assertEquals(msg.rootPart.isMultipart, true);
  for (const part of msg.parts) {
    assertEquals(part.isMultipart, false);
    assertExists(part.contentType.type);
    assertExists(part.headers);
  }
});

Deno.test("parseEager - RFC 2231 filename* in Content-Disposition", () => {
  const raw = [
    "From: test@example.com",
    "To: to@example.com",
    "Subject: RFC 2231 test",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain",
    "",
    "body",
    "--b1",
    "Content-Type: application/octet-stream",
    "Content-Disposition: attachment; filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88.txt",
    "Content-Transfer-Encoding: base64",
    "",
    "AAAA",
    "--b1--",
  ].join("\r\n");
  const msg = parseEager(raw);
  assertEquals(msg.attachments.length, 1);
  assertEquals(msg.attachments[0].filename, "テスト.txt");
});
