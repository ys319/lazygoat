import { assertEquals } from "@std/assert";
import { HeaderMap } from "./header.ts";

function makeHeaders(raw: string): HeaderMap {
  return new HeaderMap(raw);
}

Deno.test("HeaderMap - simple header get", () => {
  const hm = makeHeaders("Subject: Hello World\r\nFrom: test@example.com");
  assertEquals(hm.get("subject"), "Hello World");
  assertEquals(hm.get("from"), "test@example.com");
});

Deno.test("HeaderMap - case insensitive lookup", () => {
  const hm = makeHeaders("Content-Type: text/plain");
  assertEquals(hm.get("content-type"), "text/plain");
  assertEquals(hm.get("Content-Type"), "text/plain");
  assertEquals(hm.get("CONTENT-TYPE"), "text/plain");
});

Deno.test("HeaderMap - folded header (CRLF + space)", () => {
  const hm = makeHeaders(
    "Subject: This is a very long subject\r\n that spans multiple lines",
  );
  assertEquals(
    hm.get("subject"),
    "This is a very long subject that spans multiple lines",
  );
});

Deno.test("HeaderMap - folded header (CRLF + tab)", () => {
  const hm = makeHeaders(
    "Received: from server\r\n\tby another server",
  );
  assertEquals(hm.get("received"), "from server by another server");
});

Deno.test("HeaderMap - folded header (LF only)", () => {
  const hm = makeHeaders(
    "Subject: line1\n line2\n line3",
  );
  assertEquals(hm.get("subject"), "line1 line2 line3");
});

Deno.test("HeaderMap - missing header returns null", () => {
  const hm = makeHeaders("Subject: test");
  assertEquals(hm.get("x-nonexistent"), null);
});

Deno.test("HeaderMap - getAll with duplicate headers", () => {
  const hm = makeHeaders(
    "Received: first\r\nSubject: test\r\nReceived: second",
  );
  const all = hm.getAll("received");
  assertEquals(all.length, 2);
  assertEquals(all[0], "first");
  assertEquals(all[1], "second");
});

Deno.test("HeaderMap - has", () => {
  const hm = makeHeaders("Subject: test\r\nFrom: a@b.com");
  assertEquals(hm.has("subject"), true);
  assertEquals(hm.has("x-missing"), false);
});

Deno.test("HeaderMap - size", () => {
  const hm = makeHeaders(
    "Subject: test\r\nFrom: a@b.com\r\nTo: c@d.com",
  );
  assertEquals(hm.size, 3);
});

Deno.test("HeaderMap - entries iteration", () => {
  const hm = makeHeaders("Subject: test\r\nFrom: a@b.com");
  const entries = [...hm.entries()];
  assertEquals(entries.length, 2);
  assertEquals(entries[0][0], "Subject");
  assertEquals(entries[0][1], "test");
});

Deno.test("HeaderMap - RFC 2047 decoding", () => {
  const hm = makeHeaders(
    "Subject: =?UTF-8?B?44GT44KT44Gr44Gh44Gv?=",
  );
  assertEquals(hm.get("subject"), "こんにちは");
});

Deno.test("HeaderMap - empty header section", () => {
  const hm = makeHeaders("");
  assertEquals(hm.size, 0);
  assertEquals(hm.get("subject"), null);
});

Deno.test("HeaderMap - header with empty value", () => {
  const hm = makeHeaders("X-Empty:\r\nSubject: test");
  assertEquals(hm.get("x-empty"), "");
  assertEquals(hm.get("subject"), "test");
});

Deno.test("HeaderMap - real-world headers from test.eml", () => {
  const raw = `MIME-Version: 1.0
Date: Fri, 12 Apr 2024 15:08:31 +0900
Message-ID: <alt-test-001@example.com>
Subject: TEST
From: =?UTF-8?B?55Sw5Lit5LiA6YOO?= <tanaka@example.com>
To: user@example.com
Content-Type: multipart/alternative; boundary="000000000000939ef9064dfb54f9"`;

  const hm = makeHeaders(raw);
  assertEquals(hm.get("subject"), "TEST");
  assertEquals(hm.get("mime-version"), "1.0");
  assertEquals(hm.get("to"), "user@example.com");
  // From header should be decoded
  const from = hm.get("from")!;
  assertEquals(from.includes("田中一郎"), true);
});
