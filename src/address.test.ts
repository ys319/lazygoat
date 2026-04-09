import { assertEquals } from "@std/assert";
import { parseAddressList } from "./address.ts";

Deno.test("parseAddressList - simple address", () => {
  const result = parseAddressList("user@example.com");
  assertEquals(result.length, 1);
  assertEquals(result[0].address, "user@example.com");
  assertEquals(result[0].name, "");
});

Deno.test("parseAddressList - with display name (angle brackets)", () => {
  const result = parseAddressList('"John Doe" <john@example.com>');
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "John Doe");
  assertEquals(result[0].address, "john@example.com");
});

Deno.test("parseAddressList - unquoted display name", () => {
  const result = parseAddressList("John Doe <john@example.com>");
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "John Doe");
  assertEquals(result[0].address, "john@example.com");
});

Deno.test("parseAddressList - multiple addresses", () => {
  const result = parseAddressList(
    "alice@example.com, Bob <bob@example.com>, carol@example.com",
  );
  assertEquals(result.length, 3);
  assertEquals(result[0].address, "alice@example.com");
  assertEquals(result[1].name, "Bob");
  assertEquals(result[1].address, "bob@example.com");
  assertEquals(result[2].address, "carol@example.com");
});

Deno.test("parseAddressList - RFC 2047 encoded name", () => {
  const result = parseAddressList(
    "=?UTF-8?B?5bGx55Sw5aSq6YOO?= <yamada@example.jp>",
  );
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "山田太郎");
  assertEquals(result[0].address, "yamada@example.jp");
});

Deno.test("parseAddressList - display name with comma (quoted)", () => {
  const result = parseAddressList('"Alice, Bob" <group@example.com>');
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Alice, Bob");
  assertEquals(result[0].address, "group@example.com");
});

Deno.test("parseAddressList - display name with escaped quote", () => {
  const result = parseAddressList('"John \\"JD\\" Doe" <john@example.com>');
  assertEquals(result.length, 1);
  assertEquals(result[0].name, 'John "JD" Doe');
  assertEquals(result[0].address, "john@example.com");
});

Deno.test("parseAddressList - empty string", () => {
  assertEquals(parseAddressList(""), []);
});

Deno.test("parseAddressList - group syntax", () => {
  const result = parseAddressList(
    "friends: alice@example.com, bob@example.com;",
  );
  assertEquals(result.length, 2);
  assertEquals(result[0].address, "alice@example.com");
  assertEquals(result[1].address, "bob@example.com");
});

Deno.test("parseAddressList - undisclosed recipients group", () => {
  const result = parseAddressList("undisclosed-recipients:;");
  assertEquals(result.length, 0);
});

Deno.test("parseAddressList - angle brackets only", () => {
  const result = parseAddressList("<user@example.com>");
  assertEquals(result.length, 1);
  assertEquals(result[0].address, "user@example.com");
  assertEquals(result[0].name, "");
});

Deno.test("parseAddressList - multiline folded", () => {
  const result = parseAddressList(
    "alice@example.com,\r\n bob@example.com",
  );
  assertEquals(result.length, 2);
});

Deno.test("parseAddressList - real-world Google From header", () => {
  const result = parseAddressList(
    '"Google データエクスポート" <noreply@google.com>',
  );
  assertEquals(result.length, 1);
  assertEquals(result[0].name, "Google データエクスポート");
  assertEquals(result[0].address, "noreply@google.com");
});
