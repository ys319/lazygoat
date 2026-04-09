import { assertEquals } from "@std/assert";
import {
  decodeBase64,
  decodeCharset,
  decodeQuotedPrintable,
  decodeRfc2047,
  decodeTransferEncoding,
} from "./codec.ts";

// ── Base64 ──

Deno.test("decodeBase64 - simple ASCII", () => {
  assertEquals(
    new TextDecoder().decode(decodeBase64("SGVsbG8sIFdvcmxkIQ==")),
    "Hello, World!",
  );
});

Deno.test("decodeBase64 - empty string", () => {
  assertEquals(decodeBase64("").length, 0);
});

Deno.test("decodeBase64 - no padding", () => {
  assertEquals(
    new TextDecoder().decode(decodeBase64("YWJj")),
    "abc",
  );
});

Deno.test("decodeBase64 - single padding", () => {
  assertEquals(
    new TextDecoder().decode(decodeBase64("YWI=")),
    "ab",
  );
});

Deno.test("decodeBase64 - double padding", () => {
  assertEquals(
    new TextDecoder().decode(decodeBase64("YQ==")),
    "a",
  );
});

Deno.test("decodeBase64 - with line breaks (email style)", () => {
  const input = "SGVs\r\nbG8s\r\nIFdv\r\ncmxk\r\nIQ==";
  assertEquals(
    new TextDecoder().decode(decodeBase64(input)),
    "Hello, World!",
  );
});

Deno.test("decodeBase64 - UTF-8 Japanese text", () => {
  // "こんにちは" in UTF-8 base64
  const input = "44GT44KT44Gr44Gh44Gv";
  assertEquals(
    new TextDecoder().decode(decodeBase64(input)),
    "こんにちは",
  );
});

Deno.test("decodeBase64 - binary data round-trip", () => {
  const bytes = decodeBase64("AAECAwQFBgcICQ==");
  assertEquals(bytes, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

// ── Quoted-Printable ──

Deno.test("decodeQuotedPrintable - plain ASCII", () => {
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable("Hello, World!")),
    "Hello, World!",
  );
});

Deno.test("decodeQuotedPrintable - hex encoding", () => {
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable("=3D")),
    "=",
  );
});

Deno.test("decodeQuotedPrintable - soft line break CRLF", () => {
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable("hello=\r\nworld")),
    "helloworld",
  );
});

Deno.test("decodeQuotedPrintable - soft line break LF", () => {
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable("hello=\nworld")),
    "helloworld",
  );
});

Deno.test("decodeQuotedPrintable - UTF-8 Japanese", () => {
  // "こんにちは世界！" (Hello World in Japanese)
  const input =
    "=E3=81=93=E3=82=93=E3=81=AB=E3=81=A1=E3=81=AF=E4=B8=96=E7=95=8C=EF=BC=81";
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable(input)),
    "こんにちは世界！",
  );
});

Deno.test("decodeQuotedPrintable - mixed content", () => {
  const input = "line 1=\r\nline 2\r\nline=3D3";
  const result = new TextDecoder().decode(decodeQuotedPrintable(input));
  assertEquals(result, "line 1line 2\r\nline=3");
});

Deno.test("decodeQuotedPrintable - tab encoding", () => {
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable("=09")),
    "\t",
  );
});

Deno.test("decodeQuotedPrintable - lowercase hex", () => {
  assertEquals(
    new TextDecoder().decode(decodeQuotedPrintable("=3d")),
    "=",
  );
});

// ── RFC 2047 ──

Deno.test("decodeRfc2047 - no encoded words", () => {
  assertEquals(decodeRfc2047("Hello World"), "Hello World");
});

Deno.test("decodeRfc2047 - Base64 UTF-8", () => {
  assertEquals(
    decodeRfc2047("=?UTF-8?B?44GT44KT44Gr44Gh44Gv?="),
    "こんにちは",
  );
});

Deno.test("decodeRfc2047 - Q-encoding UTF-8", () => {
  assertEquals(
    decodeRfc2047("=?UTF-8?Q?=E3=81=93=E3=82=93=E3=81=AB=E3=81=A1=E3=81=AF?="),
    "こんにちは",
  );
});

Deno.test("decodeRfc2047 - Q-encoding underscore as space", () => {
  assertEquals(
    decodeRfc2047("=?UTF-8?Q?Hello_World?="),
    "Hello World",
  );
});

Deno.test("decodeRfc2047 - adjacent encoded words (no space between)", () => {
  const input =
    "=?UTF-8?B?44GT44KT?= =?UTF-8?B?44Gr44Gh44Gv?=";
  assertEquals(decodeRfc2047(input), "こんにちは");
});

Deno.test("decodeRfc2047 - mixed plain and encoded", () => {
  assertEquals(
    decodeRfc2047("Re: =?UTF-8?B?44GT44KT44Gr44Gh44Gv?="),
    "Re: こんにちは",
  );
});

Deno.test("decodeRfc2047 - lowercase encoding specifier", () => {
  assertEquals(
    decodeRfc2047("=?utf-8?b?44GT44KT44Gr44Gh44Gv?="),
    "こんにちは",
  );
});

Deno.test("decodeRfc2047 - ISO-8859-1 Q-encoding", () => {
  // "café" in ISO-8859-1
  assertEquals(
    decodeRfc2047("=?ISO-8859-1?Q?caf=E9?="),
    "café",
  );
});

Deno.test("decodeRfc2047 - real-world Google subject", () => {
  const input =
    "=?UTF-8?B?R29vZ2xlIOODh+ODvOOCv+OBruOCqOOCr+OCueODneODvOODiOOCkuWujOS6huOBl+OBvg==?=" +
    "\r\n\t=?UTF-8?B?44GX44Gf?=";
  const decoded = decodeRfc2047(input.replace(/\r?\n[ \t]/g, " "));
  assertEquals(decoded, "Google データのエクスポートを完了しました");
});

// ── Charset ──

Deno.test("decodeCharset - UTF-8", () => {
  const bytes = new TextEncoder().encode("こんにちは");
  assertEquals(decodeCharset(bytes, "UTF-8"), "こんにちは");
});

Deno.test("decodeCharset - us-ascii fallback", () => {
  const bytes = new Uint8Array([72, 101, 108, 108, 111]);
  assertEquals(decodeCharset(bytes, "us-ascii"), "Hello");
});

Deno.test("decodeCharset - ISO-8859-1", () => {
  // "café" in ISO-8859-1
  const bytes = new Uint8Array([99, 97, 102, 0xe9]);
  assertEquals(decodeCharset(bytes, "ISO-8859-1"), "café");
});

// ── Transfer encoding dispatch ──

Deno.test("decodeTransferEncoding - base64", () => {
  const input = new TextEncoder().encode("SGVsbG8=");
  assertEquals(
    new TextDecoder().decode(decodeTransferEncoding(input, "base64")),
    "Hello",
  );
});

Deno.test("decodeTransferEncoding - quoted-printable", () => {
  const input = new TextEncoder().encode("Hello=3DWorld");
  assertEquals(
    new TextDecoder().decode(decodeTransferEncoding(input, "quoted-printable")),
    "Hello=World",
  );
});

Deno.test("decodeTransferEncoding - 7bit passthrough", () => {
  const input = new TextEncoder().encode("Hello");
  assertEquals(decodeTransferEncoding(input, "7bit"), input);
});

Deno.test("decodeTransferEncoding - 8bit passthrough", () => {
  const input = new TextEncoder().encode("Hello");
  assertEquals(decodeTransferEncoding(input, "8bit"), input);
});

Deno.test("decodeTransferEncoding - unknown passthrough", () => {
  const input = new TextEncoder().encode("raw data");
  assertEquals(decodeTransferEncoding(input, "unknown"), input);
});

// ── Base64 edge cases (boundary checks) ──

Deno.test("decodeBase64 - single character (len < 4)", () => {
  // "=" is a degenerate input; should not crash
  const result = decodeBase64("=");
  assertEquals(result.length, 0);
});

Deno.test("decodeBase64 - two characters '=='", () => {
  // Both padding, output should be empty or minimal without crash
  const result = decodeBase64("==");
  assertEquals(result.length, 0);
});

Deno.test("decodeBase64 - whitespace only", () => {
  const result = decodeBase64("  \r\n\t  ");
  assertEquals(result.length, 0);
});
