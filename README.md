# lazygoat

[![JSR](https://jsr.io/badges/@ys319/lazygoat)](https://jsr.io/@ys319/lazygoat)

遅延評価メール (MIME) パーサー。

コンストラクタ時点ではパースを一切行わず、プロパティアクセス時に必要最小限の処理だけを実行してキャッシュします。FaaS など CPU 時間に制約がある環境で、メールの特定フィールドだけを参照するケースに最適です。

## インストール

```sh
deno add jsr:@ys319/lazygoat
```

## 使い方

### 遅延パース (デフォルト)

```ts
import { parse } from "@ys319/lazygoat";

const msg = parse(rawEmail);

// ヘッダーだけをパース — 本文には触れない
console.log(msg.subject);
console.log(msg.from); // [{ name: "Alice", address: "alice@example.com" }]

// 本文にアクセスした時点で初めてデコード
console.log(msg.text); // text/plain
console.log(msg.html); // text/html

// 添付ファイル
for (const att of msg.attachments) {
  console.log(att.filename, att.mimeType, att.content.byteLength);
}
```

### 一括パース

デバッグやシリアライズなど、全フィールドを即座に評価したい場合:

```ts
import { parseEager } from "@ys319/lazygoat";

const msg = parseEager(rawEmail);
// すべてのプロパティがプレーンオブジェクトとして即座に評価済み
```

### mbox ファイル

```ts
import { parseMbox, parseMboxStream } from "@ys319/lazygoat";

// 同期 (文字列全体を渡す)
const messages = parseMbox(mboxString);

// ストリーミング (メモリ効率が高い)
const file = await Deno.open("mailbox.mbox");
for await (const { envelope, message } of parseMboxStream(file.readable)) {
  console.log(envelope.sender, message.subject);
}
```

## API

| エクスポート | 説明 |
|---|---|
| `parse(raw)` | `LazyMessage` を返す。パースは遅延実行 |
| `parseEager(raw)` | `ParsedMessage` を返す。全プロパティを即座に評価 |
| `LazyMessage` | 遅延評価メッセージクラス |
| `HeaderMap` | 遅延評価ヘッダーマップ |
| `MimePart` | 遅延評価 MIME パート |
| `parseAddressList(input)` | RFC 5322 アドレスリストのパース |
| `parseMediaType(input)` | Content-Type ヘッダーのパース |
| `parseMbox(input)` | mbox 文字列の同期パース |
| `parseMboxStream(stream)` | mbox ストリームの非同期イテレータ |
| `countMboxMessages(stream)` | mbox 内のメッセージ数をカウント |
| `decodeBase64` / `decodeQuotedPrintable` / `decodeRfc2047` / `decodeCharset` | 低レベルコーデックユーティリティ |

### `LazyMessage` プロパティ

| プロパティ | 型 | 説明 |
|---|---|---|
| `subject` | `string` | 件名 |
| `from` / `to` / `cc` / `bcc` / `replyTo` | `Address[]` | アドレスリスト |
| `date` | `Date \| null` | 日時 |
| `messageId` | `string` | Message-ID |
| `text` | `string \| null` | text/plain 本文 |
| `html` | `string \| null` | text/html 本文 |
| `attachments` | `Attachment[]` | 添付ファイル |
| `inlineAttachments` | `Attachment[]` | インライン添付 |
| `headers` | `HeaderMap` | 全ヘッダーへのアクセス |
| `parts` | `MimePart[]` | フラット化された MIME パート |
| `rootPart` | `MimePart` | MIME ツリーのルート |
| `contentType` | `MediaType` | ルートの Content-Type |

## 対応仕様

- RFC 5322 (Internet Message Format)
- RFC 2045 / 2046 (MIME)
- RFC 2047 (ヘッダーのエンコードワード)
- RFC 2231 (パラメータのエンコーディング)
- RFC 4155 (mbox 形式)
- mboxrd エスケープ

## ライセンス

MIT
