# CLAUDE.md

このファイルは、このリポジトリ（`ai-chat`）でコードを操作する際に Claude Code (claude.ai/code) に対するガイダンスを提供します。

## プロジェクト概要

個人利用・検証目的の **エンターテイメント向けAIチャットボット** です。固定の単一ペルソナと自由に雑談できることを目的とし、認証機能を持たない軽量なWebアプリケーションとして構築します。

- 本番運用や不特定多数への公開は想定していません（検証・個人利用目的）
- そのためコンテンツモデレーション機能は実装しません
- ツール呼び出し（function calling）や外部サービス連携は行わず、純粋な会話のみを扱います（将来拡張できる構造は意識しますが、実装は不要）

## 主要機能

1. ユーザーがテキストメッセージを送信し、AI（固定ペルソナ）とチャットできる
2. AIの応答はストリーミング表示される（1文字/チャンクずつ流れるように表示）
3. 会話履歴はセッション単位でMongoDBに保存される（ログインは不要）
   - ブラウザに発行したセッションID（Cookie）で会話を紐付ける
   - 長期的なアカウント管理・複数デバイス間の同期は行わない
4. キャラクター選択機能はなし（ペルソナは1種類に固定し、system prompt等で表現する）

## 技術スタック

| レイヤー                     | 技術                                      |
| ---------------------------- | ----------------------------------------- |
| フロントエンド               | Next.js（App Router）                     |
| APIサーバー                  | Hono                                      |
| ORM                          | Prisma                                    |
| データベース                 | MongoDB（Prisma の MongoDB コネクタ経由） |
| AIエージェントフレームワーク | Mastra                                    |
| LLM                          | Claude API（Anthropic）                   |
| デプロイ先                   | Google Cloud Run                          |

### 技術選定に関する注意

- Next.js の Router（App Router）内から Hono を組み込む、または Hono を独立したAPIサーバーとして立てるかは実装時に検討する。Cloud Run へのデプロイを前提に、コンテナ化しやすい構成を優先する。
- Prisma は MongoDB コネクタを使用するため、リレーション定義や `@id` の扱いなど MongoDB 特有の制約（複合ユニーク制約の一部非対応など）に注意する。
- Mastra 経由で Claude API を呼び出す際は、ストリーミングレスポンスに対応した実装方法を採用する。

## アーキテクチャ方針

```
[Browser]
   │  (セッションCookie)
   ▼
[Next.js App Router] ── UI / ストリーミング表示
   │
   ▼
[Hono API] ── /api/chat 等のエンドポイント
   │
   ├─▶ [Mastra Agent] ── system prompt（固定ペルソナ）+ Claude API 呼び出し（ストリーミング）
   │
   └─▶ [Prisma] ──▶ [MongoDB] ── セッションに紐づく会話履歴の保存/取得
```

### ディレクトリ構成（想定・実装時に調整可）

```
ai-chat/
├── app/                # Next.js App Router（UI）
│   └── (chat)/
├── server/             # Hono アプリケーション（APIルート）
│   └── routes/
│       └── chat.ts
├── mastra/             # Mastra エージェント定義（固定ペルソナ・system prompt）
│   └── agents/
├── prisma/
│   └── schema.prisma   # MongoDB用スキーマ
└── lib/                # 共通ユーティリティ（セッションID発行など）
```

## データモデル（Prisma / MongoDB 概要）

会話履歴はセッションIDに紐づけて保存する。認証情報・ユーザーアカウントは持たない。

- `Session`: セッションID（Cookieの値）、作成日時
- `Message`: セッションへの参照、role（user / assistant）、content、作成日時（送信順の保持のため）

厳密なスキーマは実装時に `prisma/schema.prisma` で定義する。TTLインデックス等による自動削除も検討候補とする（検証目的のため長期保存は不要）。

## セッション管理

- ログイン・サインアップは実装しない
- 初回アクセス時にサーバー側でセッションIDを発行し、Cookieに保存する
- 以降のリクエストはそのセッションIDに紐づく会話履歴のみを参照・更新する
- セッションをまたいだ会話の共有・引き継ぎは考慮しない

## AI応答・ストリーミング

- Claude API の呼び出しは Mastra Agent 経由で行う
- クライアントへの応答はストリーミングで返却し、フロントエンドで逐次描画する
- ペルソナ設定（口調・性格など）は Mastra Agent の system prompt として固定で定義する

## 対象外（今回のスコープ外）

以下は明示的にスコープ外とする。実装時に安易に追加しない。

- ユーザー認証・アカウント管理
- コンテンツモデレーション（NGワード検知、Claude APIのモデレーション機能利用など）
- 複数ペルソナ・キャラクター切り替え
- ツール呼び出し（function calling）・外部サービス連携
- 会話履歴の長期保存・複数デバイス間同期

## デプロイ

- デプロイ先は **Google Cloud Run**
- コンテナビルドを前提とした構成にする（Dockerfile を用意する）
- MongoDB は Cloud Run から接続可能な外部ホスティング（MongoDB Atlas 等）を利用する想定（具体的な接続先は実装時に決定）

## 環境変数（想定）

| 変数名                | 用途                           |
| --------------------- | ------------------------------ |
| `ANTHROPIC_API_KEY`   | Claude API 認証キー            |
| `DATABASE_URL`        | MongoDB 接続文字列（Prisma用） |
| `SESSION_COOKIE_NAME` | セッションCookie名（任意）     |

機密情報は `.env` にのみ記載し、リポジトリにコミットしない。

## 開発時の注意

- ビルド・lint・テストコマンドは実装フェーズで整備する（現時点では未定義）
- 個人検証用途のため、過度なエラーハンドリングや将来を見越した抽象化は避け、シンプルな実装を優先する

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
