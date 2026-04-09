import { assertEquals } from "@std/assert";
import { parseMediaType } from "./media_type.ts";

Deno.test("parseMediaType - simple type", () => {
  const mt = parseMediaType("text/plain");
  assertEquals(mt.type, "text");
  assertEquals(mt.subtype, "plain");
  assertEquals(mt.params.size, 0);
});

Deno.test("parseMediaType - with charset", () => {
  const mt = parseMediaType('text/plain; charset="UTF-8"');
  assertEquals(mt.type, "text");
  assertEquals(mt.subtype, "plain");
  assertEquals(mt.params.get("charset"), "UTF-8");
});

Deno.test("parseMediaType - unquoted parameter", () => {
  const mt = parseMediaType("text/plain; charset=UTF-8");
  assertEquals(mt.params.get("charset"), "UTF-8");
});

Deno.test("parseMediaType - multipart with boundary", () => {
  const mt = parseMediaType(
    'multipart/alternative; boundary="----=_Part_123"',
  );
  assertEquals(mt.type, "multipart");
  assertEquals(mt.subtype, "alternative");
  assertEquals(mt.params.get("boundary"), "----=_Part_123");
});

Deno.test("parseMediaType - multiple parameters", () => {
  const mt = parseMediaType(
    'text/plain; charset="UTF-8"; format=flowed; delsp=yes',
  );
  assertEquals(mt.params.get("charset"), "UTF-8");
  assertEquals(mt.params.get("format"), "flowed");
  assertEquals(mt.params.get("delsp"), "yes");
});

Deno.test("parseMediaType - case insensitive type", () => {
  const mt = parseMediaType("TEXT/HTML");
  assertEquals(mt.type, "text");
  assertEquals(mt.subtype, "html");
});

Deno.test("parseMediaType - undefined input returns default", () => {
  const mt = parseMediaType(undefined);
  assertEquals(mt.type, "text");
  assertEquals(mt.subtype, "plain");
});

Deno.test("parseMediaType - empty input returns default", () => {
  const mt = parseMediaType("");
  assertEquals(mt.type, "text");
  assertEquals(mt.subtype, "plain");
});

Deno.test("parseMediaType - boundary without quotes", () => {
  const mt = parseMediaType(
    "multipart/mixed; boundary=000000000000939ef9064dfb54f9",
  );
  assertEquals(mt.params.get("boundary"), "000000000000939ef9064dfb54f9");
});

Deno.test("parseMediaType - parameter with escaped quote", () => {
  const mt = parseMediaType('text/plain; name="file\\"name.txt"');
  assertEquals(mt.params.get("name"), 'file"name.txt');
});

Deno.test("parseMediaType - application type", () => {
  const mt = parseMediaType("application/pdf");
  assertEquals(mt.type, "application");
  assertEquals(mt.subtype, "pdf");
});

Deno.test("parseMediaType - with whitespace around params", () => {
  const mt = parseMediaType("text/html ;  charset = UTF-8");
  assertEquals(mt.type, "text");
  assertEquals(mt.subtype, "html");
  assertEquals(mt.params.get("charset"), "UTF-8");
});

Deno.test("parseMediaType - RFC 2231 encoded parameter", () => {
  const mt = parseMediaType(
    "application/octet-stream; filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88.txt",
  );
  assertEquals(mt.params.get("filename"), "テスト.txt");
});
