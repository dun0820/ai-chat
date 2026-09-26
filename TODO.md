# AI-CHAT アプリ 実行計画（TODOリスト）

仕様は [`CLAUDE.md`](./CLAUDE.md) を参照。エンタメ向け単一ペルソナAIチャットボット（認証なし・セッション単位・ストリーミング応答）。

---

## Phase 0: プロジェクト初期セットアップ

- [x] `ai-chat/` 配下で `package.json` を初期化（monorepo構成にするか単一パッケージにするか決定）
  - 単一パッケージ構成を採用（Cloud Runへの単一コンテナデプロイのしやすさを優先）
- [x] Next.js（App Router, TypeScript）プロジェクトをセットアップ
- [x] Hono を依存関係に追加し、Next.js との統合方式を決定
  - [x] Next.js API Route内でHonoをマウントする方式 or 独立したHonoサーバーにするか検討・決定
    - `app/api/[[...route]]/route.ts` で `hono/vercel` の `handle()` を使い Next.js Route Handler内にマウントする方式を採用
  - [x] Cloud Runへのコンテナデプロイのしやすさを基準に最終判断
    - Next.jsプロセス1つのみでAPIとUIの両方を配信できるため、独立Honoサーバー（2プロセス構成）より単一コンテナ化が容易
- [x] ESLint / Prettier 等の最低限のフォーマッタ設定
  - ESLintは `create-next-app` の `eslint-config-next` をそのまま利用、Prettierを追加（`.prettierrc.json` / `.prettierignore` / `npm run format`, `format:check`）
- [x] ディレクトリ構成を CLAUDE.md の想定構成に沿って作成（`app/`, `server/`, `mastra/`, `prisma/`, `lib/`）
- [x] `.env.example` を作成（`ANTHROPIC_API_KEY`, `DATABASE_URL`, `SESSION_COOKIE_NAME`）
- [x] `.gitignore` に `.env`, `node_modules`, `.next` 等を追加
  - `.env.example` はコミット対象として除外解除（`!.env.example`）

## Phase 1: データベース設計（Prisma / MongoDB）

- [ ] MongoDB接続先を用意（ローカル検証用: Docker MongoDB、または MongoDB Atlas 無料枠）
  - Atlas無料枠を採用することを決定。クラスタ作成・接続文字列の取得はダッシュボード操作が必要なためユーザー側で対応し、取得した接続文字列を `.env` の `DATABASE_URL` に設定する
- [x] Prisma を導入し、MongoDBコネクタで初期化（`prisma/schema.prisma`）
  - Prisma 6系（`prisma@6.19.3` / `@prisma/client@6.19.3`）を採用。Prisma 7/8系は破壊的変更（datasource urlの移動、contract.prisma化等）があり、8系はnpm上でRC版のみのため見送り
- [x] `Session` モデルを定義（セッションID、作成日時）
  - Phase 2で判明: Prisma 6のMongoDBコネクタは `_id` が必ずObjectId型である制約があり、Cookieに発行するUUIDをそのまま `_id` にはできないため、Cookie値を保持する `token String @unique` フィールドを別途追加（`_id` はMongo内部の関連付け用途のみ）
- [x] `Message` モデルを定義（Sessionへの参照、role: user/assistant、content、作成日時）
  - `role` は `user` / `assistant` の enum（`MessageRole`）として定義
- [x] MongoDB特有の制約（複合ユニーク制約非対応など）を踏まえてスキーマを調整
  - unique制約は使用せず、`Message` に `sessionId + createdAt` の非unique複合インデックスのみ付与し、制約非対応の問題を回避
  - MongoDBコネクタは `prisma migrate` 非対応のため、`prisma db push` でスキーマを反映する方針とする
- [x] TTLインデックス導入の要否を検討（検証用途のため自動削除を入れるか判断）
  - Prisma 6系の `schema.prisma` では `expireAfterSeconds` を表現できない（v7/v8のcontract構文のみ対応）ため、今回は導入を見送り。必要になれば別途mongoshやスクリプトでTTLインデックスを手動作成する運用とする
- [x] `prisma generate` / 接続確認（簡単なスクリプトでCRUD疎通確認）
  - [x] `prisma generate` 実行・成功確認済み
  - [x] CRUD疎通確認スクリプト作成済み（`prisma/db-check.ts`、`npm run db:check` で実行）
  - [x] 実際のAtlas接続文字列でのCRUD疎通確認 — `npm run db:push` → `npm run db:check` で実クラスタへの接続・CRUDを確認済み
    - GCP無料トライアルの請求先アカウントではAtlas無料枠がMarketplace経由で購入できなかったため、Atlas公式サイトから直接サインアップして回避

## Phase 2: セッション管理

- [x] セッションID発行ロジックを実装（`lib/session.ts` 等、UUID生成）
  - `crypto.randomUUID()` を使用（Edge Runtime・Node.js両方で利用可能なWeb Crypto APIのため、`middleware.ts`(Edge)と`server/`(Node)の両方から共通利用できる）
- [x] 初回アクセス時にCookie（`SESSION_COOKIE_NAME`）を発行するミドルウェア/ハンドラを実装
  - `middleware.ts` で全リクエスト（静的アセット除く）に対しCookie未設定/不正なら新規発行。`NextResponse.next({ request })` で同一リクエスト内の後続ハンドラ（Hono API含む）にも即座に新しいCookie値を伝播
- [x] Cookieの属性を検討（HttpOnly, SameSite, Secure, 有効期限）
  - `HttpOnly: true`（JS からのアクセス不可）、`SameSite: Lax`（通常利用で問題なし）、`Secure: production環境のみtrue`（ローカルhttp開発を阻害しないため）、有効期限30日（ブラウザを閉じても再訪時に履歴復元できるように）
- [x] リクエストからセッションIDを取得し、該当する会話履歴のみ参照するユーティリティを実装
  - Hono側: `server/lib/session.ts` の `getSessionId(c)`（Cookieから読み取り）
  - DB側: `lib/session-store.ts` の `getOrCreateSession(sessionId)` / `getSessionMessages(sessionId)`（該当セッションの会話履歴のみ取得）
  - 動作確認用に `GET /api/session` エンドポイントを追加し、dev サーバー起動・curlで1回目/2回目リクエストとも同一sessionIdが返ることを確認済み
- [x] セッションが存在しない/不正な場合のフォールバック処理（新規セッション発行）
  - `middleware.ts` が全リクエストに対して一元的にフォールバックを担うほか、`server/lib/session.ts` の `getSessionId` でも二重の安全策として同様のフォールバックを実装

## Phase 3: Mastra Agent / Claude API 連携

- [x] Mastra を導入し、基本設定を行う
  - `@mastra/core` + `zod` のみ導入（Mastra独自のdevサーバー/CLIは使わず、`Agent` インスタンスを直接 `mastra/agents/` からexportしてHono側から呼び出す最小構成とした）
- [x] 固定ペルソナのsystem promptを設計・実装（`mastra/agents/`）
  - `mastra/agents/persona.ts`。ユーザー確認の上「落ち着いた丁寧な聞き役」の方向性でキャラクター「凪（なぎ）」を設計
- [x] Claude API（Anthropic）との連携設定（APIキーは環境変数経由）
  - モデルはMastraのモデルルーター形式 `anthropic/claude-opus-5` を指定。`ANTHROPIC_API_KEY` 環境変数から自動認証される（`@ai-sdk/anthropic`等の追加パッケージは不要）
- [x] ストリーミングレスポンスに対応したAgent呼び出し実装
  - `agent.stream()` の `stream.textStream` でチャンク単位のテキストストリームを取得できる構成を確認
- [x] ローカルで簡単なスクリプト/テストから単発リクエスト→ストリーミング出力を確認
  - `mastra/agent-check.ts`（`npm run agent:check`）を作成。実際の `ANTHROPIC_API_KEY` 設定後に実行し、ペルソナ「凪」がストリーミングで実応答を返すことを確認済み
  - 副次的発見: `tsx` で直接実行する単体スクリプトは `.env` を自動読み込みしない（Prisma CLI/Clientは独自に`.env`読み込み機能を持つが、Mastra側の呼び出しにはその仕組みがない）ため、`mastra/agent-check.ts` に `import "dotenv/config"` を追加して対応（`dotenv`をdevDependencyに追加）

## Phase 4: Hono API実装

- [x] `/api/chat` エンドポイントを実装（POST: ユーザーメッセージ受信）
  - `server/routes/chat.ts`。`{ message: string }` を受け取り、空文字/型不正は400を返す
- [x] セッションIDに紐づく会話履歴をPrisma経由で取得し、Mastra Agentへのコンテキストとして渡す
  - `getSessionMessages` で取得した履歴 + 新規ユーザーメッセージを `CoreMessage[]` 形式に変換し `personaAgent.stream()` に渡す（Mastra自体のMemory機能は使わず、既存のPrisma履歴をそのまま渡すステートレスな方式）
- [x] Mastra Agentからのストリーミング応答をクライアントへストリーム転送（Server-Sent Events / ReadableStream等の方式を決定）
  - SSEではなく `hono/streaming` の `streamText()` によるプレーンテキストのchunked streamingを採用（1文字/チャンクずつの表示要件に対してシンプルで、フロントは`response.body`を直接読めるため）
- [x] 応答完了後、ユーザーメッセージ・AI応答の両方をMongoDBに保存
  - ストリーミング完了後にuser→assistantの順で`prisma.message.create`を実行し、createdAtの前後関係を保証
- [x] エラーハンドリング（Claude API失敗時、DB書き込み失敗時）は最低限に留める（過度な抽象化を避ける）
  - Agent呼び出し開始失敗は502 JSON、ストリーミング中/DB保存時のエラーはconsole.errorのみ（レスポンスヘッダー送信済みのため）とし、最低限に留めた
  - dev サーバー + curl で `/api/chat` の疎通確認（バリデーション400、DB未接続時の500、実際のAtlas+Claude API接続での会話・履歴保存まですべて確認済み）
  - 副次的発見: Next.js 16.3.6では`middleware.ts`が非推奨になり`proxy.ts`に名称変更されていたため、Phase 2で作成した`middleware.ts`を`proxy.ts`（`export function proxy`）に移行した

## Phase 5: フロントエンド実装（Next.js）

- [x] チャットUIの基本レイアウトを実装（`app/(chat)/`）
  - `app/(chat)/page.tsx`。デフォルトの`app/page.tsx`テンプレートを削除し置き換え（ルートグループのため URL は引き続き `/`）
- [x] メッセージ入力フォーム・送信ボタンの実装
- [x] 会話履歴の初期表示（マウント時にセッションの履歴を取得して表示）
  - 新規に `GET /api/messages`（`server/routes/chat.ts`）を追加し、マウント時の`useEffect`で取得
- [x] `/api/chat` へのストリーミングリクエスト送信とレスポンス受信処理
  - `fetch` + `response.body.getReader()` + `TextDecoder` でプレーンテキストストリームを逐次読み取り
- [x] AI応答をチャンク単位で逐次描画するUIロジック実装
  - 受信チャンクを直前に追加した空のassistantメッセージへ逐次追記
- [x] 送信中・ストリーミング中のUI状態管理（ローディング表示など）
  - 履歴読み込み中／送信中でそれぞれ入力欄・送信ボタンを無効化し、ローディング文言を表示
- [x] 最低限のスタイリング（デザインシステムは軽量なもので可）
  - create-next-app標準のTailwind CSSのみ使用（追加ライブラリなし）。ダークモード（`prefers-color-scheme`）にも対応
  - 動作確認: `npm run build` 成功、dev サーバー + curl でトップページのSSR出力に想定要素（見出し・入力欄・ローディング表示）が含まれることを確認。**Chrome拡張が未接続のため実際のブラウザでのクリック操作・ストリーミング表示の目視確認は未実施**（DB/Claude APIとも本番接続がまだのため、実際の会話フローの確認はAtlas・APIキー設定後にユーザー側で必要）

## Phase 6: 動作確認

現時点ではMongoDB Atlas・Claude APIキーとも本番接続情報が未設定（`.env`がプレースホルダー）のため、実DB・実AI応答を伴う完全なE2E確認はユーザー側の環境設定後に必要。今回は「今できる範囲だけ確認する」方針とし、コードレベル・curlレベルで検証可能な範囲を確認した上で、Vitestによる自動テストで挙動を担保した。

- [~] ローカル環境で一連のチャットフロー（初回アクセス→セッション発行→会話→履歴保存→再訪時の履歴復元）を手動確認
  - 確認済み: 初回アクセスでのセッション発行、Cookie維持による同一セッションの継続（curl、`proxy.ts`/`getSessionId`の自動テストでも検証）
  - 未確認（要Atlas接続）: 実DBへの履歴保存・再訪時の履歴復元。ロジック自体は`server/routes/chat.test.ts`でフェイクDBを使い検証済み
- [~] ストリーミング表示が実際にチャンク単位で流れることをブラウザで確認
  - 確認済み: HTTPレイヤーでのchunkごとのストリーミング転送を自動テストで検証（`server/routes/chat.test.ts`）
  - 未確認: 実際のブラウザでの目視確認（Chrome拡張未接続）、実Claude APIからの応答での確認
- [x] 複数セッション（別ブラウザ/シークレットウィンドウ）で会話が混ざらないことを確認
  - curlで別Cookie jar（別クライアント相当）が別sessionIdを持つことを確認
  - `server/routes/chat.test.ts`でセッションA/Bの会話履歴・agent呼び出しコンテキストが混ざらないことを自動テストで検証済み
- [x] 必要に応じて簡易な自動テストを追加（対象範囲は最小限）
  - Vitestを導入（`npm run test`）。対象は「今できる範囲」の核となる4ファイル:
    - `lib/session.test.ts`: セッションID生成・バリデーションの純粋関数テスト
    - `server/lib/session.test.ts`: HonoコンテキストでのセッションID取得・新規発行のテスト（実Honoアプリを`app.request()`で実行）
    - `proxy.test.ts`: Cookie発行・維持・不正値時のフォールバック・Cookie属性のテスト（実`NextRequest`/`NextResponse`使用）
    - `server/routes/chat.test.ts`: `/api/chat`のバリデーション・チャンク単位ストリーミング・履歴の保存順序・複数ターンでのコンテキスト受け渡し・セッション分離を検証。Prisma(DB)とMastra Agent(Claude API)のみをインメモリのフェイクでモックし、それ以外（Honoルーティング・セッション解決・ストリーミング処理）は実コードをそのまま実行
  - 28件全てパス、意味のあるアサーション（具体的な入力・期待値）のみで`expect(true).toBe(true)`のような無意味な検証はなし
  - ハードコードなし（本番コードにテスト専用分岐は追加していない。テスト対象はモック境界を除き実装コードそのもの）

## Phase 7: コンテナ化・デプロイ準備

- [x] `Dockerfile` を作成（Next.js + Hono をまとめて起動できる構成）
  - Hono は独立プロセスではなく `app/api/[[...route]]/route.ts` 経由でNext.jsに統合済み（Phase 0の決定通り）のため、`server.js` 1プロセスの起動でAPI/UI両方が動く
  - `next.config.ts` に `output: "standalone"` を追加。ローカルで `npm run build` を実行し、`.next/standalone/server.js` と、NFT(Output File Tracing)によりPrismaクライアント+クエリエンジンバイナリが自動的に含まれることを確認済み(`.prisma/client/libquery_engine-*.so.node` が `.next/standalone/node_modules/` 配下に存在)。そのため runner ステージでの `.prisma`/`@prisma/client` の手動コピーは不要と判断
- [x] マルチステージビルドでイメージサイズを最適化
  - `deps`(依存関係インストール) → `builder`(`next build`) → `runner`(standalone出力 + `public` + `.next/static` のみ) の3段構成。runnerには`node_modules`全体やソース一式を含めない
  - 非rootユーザー(`nextjs`)で実行するよう構成
- [~] コンテナ起動確認（ローカルDockerで `docker run` して疎通確認）
  - **このサンドボックス環境にはDocker CLIが存在しないため、`docker build`/`docker run` 自体は実行できていない**（`docker: command not found`）。Dockerfileの静的な妥当性確認と、同等の内容を`npm run build`（standalone出力）で検証したのみ
  - 重要な発見: Next.jsのstandalone出力は`.env`ファイルをそのまま`.next/standalone/.env`にコピーする仕様のため、`.env`に本物の秘密情報を入れた状態でDockerビルドすると秘密情報がイメージに焼き込まれてしまう。`.dockerignore`で`.env`/`.env.*`を除外することで対応済み（ビルド時の`DATABASE_URL`等はDockerfile内のダミー値`ENV`で代替し、実接続はCloud Run側の環境変数で行う）
  - ユーザー側でDocker環境（ローカルDocker Desktop、Cloud Build等）から以下を実行して疎通確認が必要:
    ```
    docker build -t ai-chat .
    docker run --rm -p 8080:8080 -e DATABASE_URL=... -e ANTHROPIC_API_KEY=... ai-chat
    curl http://localhost:8080/api/health
    ```
  - Cloud Runへのデプロイはlinux/amd64が前提のため、Apple SiliconなどARM環境でビルドする場合は `docker build --platform linux/amd64` を明示する必要がある点に注意（Prismaのクエリエンジンバイナリはビルド時のアーキテクチャに依存するため）
- [x] 環境変数をCloud Run側で設定する方針を整理（Secret Manager利用の要否含む）
  - `ANTHROPIC_API_KEY` と `DATABASE_URL` は機密情報のため **Secret Manager経由で参照**する方針（Cloud Runの「シークレットを環境変数として参照」機能を使用）
  - `SESSION_COOKIE_NAME` は非機密のため通常の環境変数（`--set-env-vars`）で設定
  - 実際のCloud Run設定コマンドはPhase 8で実施
- [x] MongoDB Atlas等、Cloud Runから接続可能な本番/検証用DBを用意
  - Atlas無料枠(M0, cluster0)を作成。Network Accessに`0.0.0.0/0`を追加し、Cloud Run(固定egress IPを持たない)からの接続を許可
  - デプロイ後に発覚した問題2件と対応:
    1. `node:24-slim`にOpenSSLが無くPrismaのクエリエンジンが正しいバイナリターゲットを検出できず、Atlasとのtls handshakeが`fatal alert: InternalError`で失敗 → Dockerfileの全ステージに`apt-get install openssl`を追加
    2. Atlas Network AccessにdevcontainerのIPしか登録されておらずCloud Runからの接続が拒否されていた → `0.0.0.0/0`を追加して解決
  - 本番Cloud Run環境で実際にチャット送信・履歴保存・履歴取得まで一連の動作を確認済み

## Phase 8: Cloud Runへのデプロイ

- [x] GCPプロジェクト・Cloud Runサービスの準備
  - プロジェクト `ai-chat-509723`（課金有効）、リージョン `asia-northeast1`（東京）を使用
  - 必要API（Cloud Run, Cloud Build, Artifact Registry, Secret Manager）を有効化
  - 新規プロジェクトのためデフォルトサービスアカウント（`744236266296-compute@developer.gserviceaccount.com`）に `roles/cloudbuild.builds.builder` と `roles/secretmanager.secretAccessor` の付与が必要だった（両方とも初回デプロイ時にエラーで判明し対応）
- [x] コンテナイメージをArtifact Registry等にpush
  - ローカルにDocker CLIが無いため、`gcloud run deploy --source .` でCloud Build経由のビルド・Artifact Registryへのpushまで一括実行（linux/amd64で自動ビルドされるためローカルの`docker build --platform`指定は不要だった）
  - `.gcloudignore` を作成し、ソースアップロード時に `.env`（秘密情報）を含めないよう対応
- [x] Cloud Runへデプロイし、環境変数（`ANTHROPIC_API_KEY`, `DATABASE_URL`, `SESSION_COOKIE_NAME`）を設定
  - `ANTHROPIC_API_KEY` / `DATABASE_URL` は Secret Manager（`anthropic-api-key`, `database-url`）経由で`--set-secrets`により注入、`SESSION_COOKIE_NAME`は`--set-env-vars`
  - `--min-instances=0`（コスト抑制のためユーザー指示）で明示指定。実際に `autoscaling.knative.dev/minScale` アノテーションが付与されておらず(=デフォルトの0のまま)、スケールtoゼロが有効なことを確認
  - デプロイURL: `https://ai-chat-744236266296.asia-northeast1.run.app`
- [x] デプロイ後の疎通確認（チャットが実際に動作するか）
  - `/api/health` → 200、トップページ → 200、`/api/session` → Cookie発行を確認
  - `/api/messages` は **MongoDB Atlas の `DATABASE_URL` がまだプレースホルダーのため500**（想定通り）。Atlas接続文字列を設定後、Secret Managerの`database-url`を更新すれば動作するはず
- [x] Cookie周りの挙動をHTTPS環境（Cloud Run）で再確認（Secure属性等）
  - 本番(HTTPS)環境で `Secure; HttpOnly; SameSite=lax` が正しく付与されることを確認（ローカルdevではSecureが付かないのは`NODE_ENV=production`分岐による意図通りの挙動）

## Phase 8.5: GitHub Actionsによる自動デプロイ（追加対応）

- [x] GitHubリポジトリを作成し、コードをpush
  - `https://github.com/dun0820/ai-chat`（public）。初回コミット・push完了
- [x] GCP側の認証をWorkload Identity Federation (WIF) で構築
  - サービスアカウントキー(JSON)を発行しない、Google推奨のセキュアな方式を採用
  - 専用サービスアカウント `github-deployer@ai-chat-509723.iam.gserviceaccount.com` を作成し、`roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/artifactregistry.writer`, `roles/storage.admin`, および実行時サービスアカウントへの`roles/iam.serviceAccountUser`を付与
  - Workload Identity Pool(`github-pool`)/ Provider(`github-provider`)を作成し、`attribute.repository == 'dun0820/ai-chat'` のリポジトリからのみ、かつ`repository_owner == 'dun0820'`の条件付きでサービスアカウントの権限借用(`roles/iam.workloadIdentityUser`)を許可
  - 最近のgcloudでは`--attribute-condition`の明示指定が必須になっている点に注意(未指定だとエラー)
- [x] `.github/workflows/deploy.yml` を作成
  - `test`ジョブ(lint + vitest) → `deploy`ジョブ(Cloud Run) の2段構成。`main`ブランチへのpushで自動実行、`workflow_dispatch`で手動実行も可能
  - デプロイ内容はローカルで実行していたコマンドと同一(`--source .`によるCloud Build経由ビルド、Secret Manager参照、`--min-instances=0`)
- [x] GitHub Secretsを設定(`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`)
- [x] 実際にpush→自動デプロイの一連の流れを確認
  - 初回実行はpushの直後にsecrets設定が間に合わず認証エラーになったが、secrets設定完了後に再実行(`gh run rerun`)して成功。以降のpushでは同じ問題は起きない
  - デプロイ後 `/api/health` が200を返すことを確認済み

---

## スコープ外（実装しない）

- ユーザー認証・アカウント管理
- コンテンツモデレーション
- 複数ペルソナ・キャラクター切り替え
- ツール呼び出し（function calling）・外部サービス連携
- 会話履歴の長期保存・複数デバイス間同期
